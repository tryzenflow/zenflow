/**
 * The rolling ingestion scheduler's arithmetic (issue #56).
 *
 * ## The problem this exists to solve
 *
 * Each watcher used to be one plain `@Cron` whose firing swept the **entire**
 * student population in a single instant. Adding a cache fixes how *many*
 * requests happen; it does nothing about *when*. Every request that still has
 * to happen — every student's own login, every cache-miss walk — lands in the
 * same few-minute window every day. Against a real university portal, several
 * hundred logins back to back is a recognisable batch job, not organic traffic.
 *
 * So each `(integration, kind)` pair carries its own `nextDueAt`, and a
 * short-interval ticker claims only the most-overdue `batchSize` of them. Same
 * total daily volume, spread continuously across the day.
 *
 * Pure: `now` is always a parameter, there is no I/O and — see
 * {@link nextDueAfterRun} — deliberately no randomness (invariant #2).
 */

/**
 * How often the ticker fires. Must stay in step with the `@Cron` on
 * `IngestionTickerService`, which is why both read this constant's value from
 * one place rather than each spelling out a minute.
 *
 * One minute is a floor, not a cadence: the actual refresh rate of any kind is
 * `targetPeriodMs`, and the heartbeat only sets how finely the work is diced.
 * It is also exactly what the recorded measurement baseline was taken at
 * (`scripts/fixtures/dlu/README.md`), so a measurement run can reproduce the
 * old burst shape purely by config.
 */
export const TICK_INTERVAL_MS = 60_000;

/**
 * The five independently-scheduled kinds of sync work.
 *
 * A local string union rather than the generated Prisma `IngestionSyncKind`
 * enum, because `ingestion/core/*` must not import Prisma or Nest — the I/O
 * layer maps between the two at the boundary, exactly as
 * `MaterializerService` maps `SessionSource` to its own `IngestedSource`.
 */
export type SyncKindName =
  | "PORTAL_DISCOVERY"
  | "LMS_DISCOVERY"
  | "PORTAL_TIMETABLE"
  | "PORTAL_EXAM"
  | "LMS_CALENDAR";

/** Which DLU system a kind talks to — the `Integration.provider` it needs. */
export type SyncKindProvider = "LMS" | "PORTAL";

/** Everything the ticker needs to know about one kind. */
export interface SyncKindPlan {
  kind: SyncKindName;
  provider: SyncKindProvider;
  /** How often each student should be refreshed for this kind. */
  targetPeriodMs: number;
  /**
   * Sort position within a tick. Discovery kinds run first, so a student's
   * confirmed set is already known when their walk runs on the same tick.
   */
  order: number;
  /** True for the two kinds that answer "which sections is this student in". */
  discovery: boolean;
}

/** True when `kind` is one of the two discovery kinds. */
export function isDiscoveryKind(kind: SyncKindName): boolean {
  return kind === "PORTAL_DISCOVERY" || kind === "LMS_DISCOVERY";
}

/** The provider a kind's `Integration` rows live under. */
export function providerOfKind(kind: SyncKindName): SyncKindProvider {
  return kind === "LMS_DISCOVERY" || kind === "LMS_CALENDAR" ? "LMS" : "PORTAL";
}

/** Plans sorted the way a tick must process them: discovery kinds first. */
export function orderedPlans(
  plans: readonly SyncKindPlan[],
): readonly SyncKindPlan[] {
  return [...plans].sort((a, b) => a.order - b.order);
}

/** Inputs to {@link batchSizeFor}. */
export interface BatchSizeInput {
  /** How many integrations exist for this kind's provider. */
  population: number;
  targetPeriodMs: number;
  tickIntervalMs: number;
  /** Floor, so a two-student deployment still makes progress. */
  minBatch: number;
  /** Ceiling, so a mis-set period cannot reproduce the old burst. */
  maxBatch: number;
}

/**
 * How many targets one tick may claim for one kind.
 *
 * `population / ticksPerPeriod`, rounded up — the whole "same volume, different
 * shape" claim lives in this one line. 500 students on a 24-hour period with
 * 5-minute ticks is 288 ticks/day, so ~2 students per tick; the same 500 on
 * one-minute ticks is 1440 ticks/day, so 1.
 *
 * Clamped at both ends. `minBatch` keeps a small deployment moving (10 students
 * over 1440 ticks rounds to 0 without it, and nothing would ever sync).
 * `maxBatch` is the safety rail: it is what makes "the load is spread" a
 * property of the code rather than of whoever last edited the env file.
 */
export function batchSizeFor(input: BatchSizeInput): number {
  const { population, targetPeriodMs, tickIntervalMs, minBatch, maxBatch } =
    input;
  if (population <= 0) return 0;

  // A period shorter than one tick means "every tick, everyone" — the degenerate
  // case a measurement run uses on purpose to reproduce the pre-#56 burst.
  const ticksPerPeriod = Math.max(1, targetPeriodMs / tickIntervalMs);
  const ideal = Math.ceil(population / ticksPerPeriod);

  return Math.min(maxBatch, Math.max(minBatch, ideal));
}

/**
 * When a just-claimed target becomes due again.
 *
 * Measured from `now` — the instant of the claim — and **not** from the row's
 * previous `nextDueAt`. That difference is the whole de-bursting mechanism, so
 * it must not be "tidied up":
 *
 *  - Stamping `previousDue + period` would preserve the original firing pattern
 *    forever. Every row seeded at the same instant would stay in lockstep, and
 *    a deployment that seeds its whole population at once would burst once per
 *    period until the end of time.
 *  - Stamping `now + period` lets each row's due time drift by its own position
 *    in the drain queue. A population all seeded at T is claimed at
 *    T, T+1min, T+2min… so it comes back due at T+P, T+P+1min, T+P+2min… —
 *    already spread, and it stays spread.
 *
 * This is also why there is no jitter and no PRNG here. `core/*` bans
 * randomness, and the backlog spreads itself: the initial all-due-at-once state
 * drains at `batchSize` per tick over exactly one target period, which *is* a
 * uniform distribution. Anyone tempted to add a random offset should read the
 * drain test in `schedule-plan.spec.ts` first.
 */
export function nextDueAfterRun(now: Date, targetPeriodMs: number): Date {
  return new Date(now.getTime() + targetPeriodMs);
}

/**
 * The stable key for an academic term — what `IngestionSchedule.lastSuccessTerm`
 * stores and the timetable gate compares against.
 */
export function termKey(term: {
  academicYear: string;
  semester: string;
}): string {
  return `${term.academicYear}/${term.semester}`;
}

/**
 * How long a row that is due only because its term changed is left alone after
 * a claim. Without it a student whose discovery keeps failing would be pulled
 * forward and re-claimed every tick, crowding out everyone queued behind them.
 */
export const TERM_RETRY_MS = 60 * 60_000;

/**
 * Has discovery covered `current`? True only when the last clean pass was for
 * exactly that term; `""` (never) and last term's key are both false.
 */
export function discoveredForTerm(
  lastSuccessTerm: string | null | undefined,
  current: { academicYear: string; semester: string },
): boolean {
  return lastSuccessTerm === termKey(current);
}

/**
 * Must this pass be a full live walk regardless of how fresh the cache looks?
 *
 * Every `fullWalkEvery` consecutive cache-served passes, one pass walks anyway.
 * Without it a cohort could sit indefinitely on occurrence rows that some other
 * student keeps refreshing just often enough to look fresh, and a genuine
 * upstream change to a section nobody walks would never be noticed. It is the
 * audit that bounds how wrong the cache can quietly be.
 */
export function mustFullWalk(input: {
  cacheHitStreak: number;
  fullWalkEvery: number;
}): boolean {
  if (input.fullWalkEvery <= 0) return true;
  return input.cacheHitStreak >= input.fullWalkEvery;
}
