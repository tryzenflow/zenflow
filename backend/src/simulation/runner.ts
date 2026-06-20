import { Logger } from "@nestjs/common";
import type { PrismaService } from "../prisma/prisma.service";
import type { TasksService } from "../tasks/tasks.service";
import type { SchedulerService } from "../scheduler/scheduler.service";
import type { AbandonedTasksService } from "../scheduler/abandoned-tasks.service";
import type { Task, User } from "../../generated/prisma";
import type {
  CreateTaskInput,
  CreateTaskResponse,
  SchedulingOverflow,
  ViewMode,
} from "@zenflow/shared";
import { feasibleSlots, intervalOf } from "../scheduler/edf";
import type { Interval } from "../scheduler/slot";
import { makeRng, round15, seedFor, type Rng } from "./rng";
import { SimClock } from "./clock";
import {
  ARCHETYPES,
  POPULATION,
  archetypeById,
  type ArchetypeId,
} from "./personas/archetypes";
import {
  buildPersonaRecord,
  seedPersona,
  type Persona,
} from "./personas/persona.factory";
import { generateTasksForDay, type TaskSpec } from "./behavior/task-generator";
import {
  decideOutcome,
  decidePlacement,
  decideResize,
  type ReactionTask,
} from "./behavior/reaction.model";
import { PersonaState, type DueTask } from "./batched/engine";
import { bulkWrite, type PersonaOutput } from "./batched/writer";
import { toGroundTruth, type PersonaGroundTruth } from "./eval/ground-truth";

/**
 * The closed-loop driver (seed doc §2.7). Per simulated day, per persona:
 * generate tasks → create → react (move / resize) within the EDF feasible set →
 * settle outcomes (complete / reschedule / abandon).
 *
 * The day-by-day decision LOGIC is written ONCE in {@link drivePersona} against an
 * {@link Actuator} seam, with two implementations:
 *  - {@link BatchedActuator} (default) computes the whole lifecycle in memory via
 *    the shared pure builders, then the run bulk-writes it in 50k-row batches —
 *    orders of magnitude faster than per-row writes for a year-long population.
 *  - {@link ServiceActuator} drives the REAL `TasksService`/`SchedulerService` so
 *    telemetry is produced through the literal production path (`--mode=service`).
 * Both share the pure scheduler core + telemetry builders, so they produce the
 * same shape of telemetry; the batched path just skips the database round-trips.
 *
 * Disciplines preserved from the seed doc: a virtual `now` is threaded into every
 * mutation (§1.1), and the service path re-fetches the `User` before each
 * matrix-mutating call so accumulated `preferenceMatrix` isn't clobbered (§1.2).
 */

export type SimMode = "batched" | "service";

/**
 * Which placement re-ranker an arm drives (eval Step 5 A/B):
 *  - `identity` — Phase-1 EDF earliest-fit (Arm A, the baseline).
 *  - `phase2`   — the signed-matrix {@link preferenceMatrixReRanker} re-ranking
 *    EDF's feasible set, plus per-tag duration correction as preprocessing
 *    (Arm B). Both read the persona's OWN accumulating matrix + telemetry, so the
 *    learner sees exactly what production would.
 */
export type RerankerKind = "identity" | "phase2";

export interface RunOptions {
  tasks: TasksService;
  scheduler: SchedulerService;
  abandoned: AbandonedTasksService;
  prisma: PrismaService;
  seed: number;
  start: string; // YYYY-MM-DD
  days: number;
  /** Placement policy for this run/arm (eval Step 5). Defaults to `identity`. */
  reranker: RerankerKind;
  /** Optional cap on personas (smoke runs); defaults to the full POPULATION. */
  personaLimit?: number;
  /**
   * Service path only: how many personas to drive CONCURRENTLY. Personas own
   * disjoint `User` rows + independent seeded RNG streams, so a batch only
   * interleaves DB I/O. Defaults to 1. (Ignored by the batched path, which is
   * in-memory + CPU-bound and bulk-writes per persona.)
   */
  concurrency?: number;
  /** Persistence strategy. Defaults to `batched`. */
  mode?: SimMode;
}

export interface RunResult {
  personas: { userId: string; archetypeId: ArchetypeId; index: number }[];
  /** Out-of-band labels (ground truth) — never written to a learner-visible column. */
  labels: { userId: string; archetypeId: ArchetypeId }[];
  /** Per-persona hidden fields for the recovery sidecar (eval Step 0). */
  groundTruth: PersonaGroundTruth[];
  eventCounts: Record<string, number>;
}

const logger = new Logger("Simulation");

// ─────────────────────────────── Actuator seam ─────────────────────────────

type Awaitable<T> = T | Promise<T>;

/** What {@link drivePersona} needs from the world; see the two implementations. */
interface Actuator {
  create(
    input: CreateTaskInput,
    now: Date,
  ): Awaitable<{
    placedAt: Date | null;
    overflow: SchedulingOverflow | null;
    taskId: string;
  }>;
  resolveOverflow(
    taskId: string,
    choice: "outsideHours" | "nextAvailable",
    view: ViewMode,
    now: Date,
  ): Awaitable<void>;
  feasible(taskId: string, now: Date): Awaitable<Date[]>;
  readTask(taskId: string): Awaitable<{
    scheduledStartTime: Date | null;
    durationMinutes: number;
  } | null>;
  reschedule(taskId: string, to: Date, now: Date): Awaitable<void>;
  resize(taskId: string, start: Date, dur: number, now: Date): Awaitable<void>;
  duePending(cutoff: Date): Awaitable<DueTask[]>;
  complete(taskId: string, now: Date): Awaitable<void>;
  sweep(now: Date): Awaitable<void>;
}

// ─────────────────────────────── helpers ───────────────────────────────────

/** Build the ordered list of (archetype, index) to seed. */
function plannedPersonas(
  limit?: number,
): { archetype: ArchetypeId; index: number }[] {
  const out: { archetype: ArchetypeId; index: number }[] = [];
  let idx = 0;
  for (const p of POPULATION) {
    for (let i = 0; i < p.count; i++)
      out.push({ archetype: p.archetype, index: idx++ });
  }
  return limit ? out.slice(0, limit) : out;
}

/** A persona is idle on a non-work weekday-zero day, a vacation, or a holiday. */
function isIdle(persona: Persona, day: number, holidays: Set<number>): boolean {
  if (holidays.has(day)) return true;
  for (const [s, e] of persona.idleWindows)
    if (day >= s && day <= e) return true;
  return false;
}

/** Advance an action time by 1…`maxMin` simulated minutes (monotonic in-day). */
function laterThan(now: Date, rng: Rng, maxMin = 8): Date {
  return new Date(now.getTime() + (1 + rng.int(maxMin)) * 60_000);
}

/** Reaction-model view of a task, derivable entirely from its create spec. */
function toReactionTask(spec: TaskSpec): ReactionTask {
  return {
    tags: spec.tags,
    deadline: spec.input.deadline ? new Date(spec.input.deadline) : null,
    durationMinutes: spec.input.durationMinutes,
    trueDurationMinutes: spec.trueDurationMinutes,
  };
}

// ─────────────────────────── the shared drive loop ─────────────────────────

/** Drive a single persona across the full span through the {@link Actuator}. */
async function drivePersona(
  act: Actuator,
  persona: Persona,
  clock: SimClock,
  holidays: Set<number>,
  rng: Rng,
  days: number,
): Promise<void> {
  let recentLoad = 0; // rolling fatigue proxy

  for (let day = 0; day < days; day++) {
    if (isIdle(persona, day, holidays)) continue;
    if (
      !persona.prefs.workDays.includes(clock.isoWeekday(day)) &&
      rng.bool(0.9)
    )
      continue;

    const specs = generateTasksForDay(persona, clock, day, rng);
    for (const spec of specs) {
      const arriveAt = clock.at(
        day,
        spec.arrivalMinute,
        persona.prefs.timezone,
      );

      let created: {
        placedAt: Date | null;
        overflow: SchedulingOverflow | null;
        taskId: string;
      };
      try {
        created = await act.create(spec.input, arriveAt);
      } catch (e) {
        logger.warn(`create failed for ${persona.userId}: ${String(e)}`);
        continue;
      }
      const { placedAt, overflow, taskId } = created;

      // Unplaced → maybe accept a recovery option, then move on.
      if (placedAt === null && overflow && rng.bool(persona.editPropensity)) {
        // `nextAvailable` IGNORES the deadline (it lands in the next period), so
        // accepting it for a deadline-bearing task would schedule the task AFTER
        // its own deadline. A realistic persona won't do that — leave such a task
        // unplaced (it stays overdue / gets abandoned) and only ever accept
        // `outsideHours`, which respects the deadline.
        const choice = overflow.outsideHours
          ? "outsideHours"
          : overflow.nextAvailable && spec.input.deadline == null
            ? "nextAvailable"
            : null;
        if (choice) {
          await act.resolveOverflow(
            taskId,
            choice,
            spec.input.view ?? "day",
            arriveAt,
          );
        }
        continue;
      }
      if (placedAt === null) continue;

      // Placement channel: react to the suggested slot within the feasible set.
      const suggested = placedAt;
      const rt = toReactionTask(spec);

      // Manual adjustments happen strictly AFTER the create: advance a per-task
      // action clock so every MOVE/RESIZE is stamped later than the CREATE event
      // (a human creates, then nudges — never simultaneously).
      let actionAt = laterThan(arriveAt, rng);
      let currentStart = suggested;
      let currentDur = spec.input.durationMinutes;

      const feasible = await act.feasible(taskId, actionAt);
      const move = decidePlacement(persona, rt, suggested, feasible, rng);
      if (move) {
        await act.reschedule(taskId, move, actionAt);
        currentStart = move;
      }

      // Duration channel: resize toward the true duration when it mismatches.
      const newDur = decideResize(persona, rt, rng);
      if (newDur !== null) {
        actionAt = laterThan(actionAt, rng);
        await act.resize(taskId, currentStart, newDur, actionAt);
        currentDur = newDur;
      }

      // Intermediate fidgeting: a few realistic in-day nudges gated by the
      // persona's edit propensity — small moves to a nearby feasible slot and
      // minor duration tweaks. Each is stamped later again, so the telemetry
      // carries MOVE/RESIZE noise that mirrors how restlessly someone tends
      // their schedule, WITHOUT manufacturing conflicts (moves stay in the
      // feasible/non-overlapping set).
      let fidgets = 0;
      while (fidgets < 2 && rng.bool(persona.editPropensity * 0.35)) {
        fidgets++;
        actionAt = laterThan(actionAt, rng, 30);
        const fresh = await act.readTask(taskId);
        if (!fresh) break;
        if (rng.bool(0.6)) {
          // Small move: re-enumerate and drift to a nearby free slot (humans
          // fidget imperfectly — not necessarily the optimum).
          const feas = await act.feasible(taskId, actionAt);
          if (feas.length > 1) {
            const near = feas[rng.int(Math.min(feas.length, 4))];
            if (
              near.getTime() !== (fresh.scheduledStartTime?.getTime() ?? -1)
            ) {
              await act.reschedule(taskId, near, actionAt);
              currentStart = near;
            }
          }
        } else {
          // Minor duration tweak around the current estimate.
          const jittered = round15(currentDur * (1 + rng.normal(0, 0.12)));
          if (jittered !== currentDur && jittered >= 15) {
            await act.resize(taskId, currentStart, jittered, actionAt);
            currentDur = jittered;
          }
        }
      }
    }

    // Settle outcomes for tasks whose slot has passed by end-of-day.
    const cutoff = clock.endOf(day, persona.prefs.timezone);
    const due = await act.duePending(cutoff);
    for (const t of due) {
      const fatigue = Math.min(1, recentLoad / 4);
      const outcome = decideOutcome(persona, t, cutoff, fatigue, rng);
      if (outcome === "complete") {
        // Finished — but real users only TICK OFF a fraction of finished work,
        // so a chunk stays PENDING (revisited later). This is why a realistic
        // board shows lots of done-but-unmarked tasks lingering.
        if (!rng.bool(persona.markCompleteRate)) {
          recentLoad += t.durationMinutes / 120; // effort spent, just not marked
          continue;
        }
        const completionAt = new Date(
          t.scheduledStartTime!.getTime() + t.durationMinutes * 60_000,
        );
        await act.complete(t.id, completionAt);
        recentLoad += t.durationMinutes / 120;
      } else if (outcome === "reschedule") {
        const next = await nextDaySlot(act, persona, t, clock, day, rng);
        if (next) await act.reschedule(t.id, next, cutoff);
        recentLoad += 0.2;
      }
      // 'abandon' is left to the overdue sweep below.
    }
    recentLoad *= 0.6; // decay fatigue overnight

    // ABANDON deadline-expired PENDING tasks. Held back during the held-out TAIL
    // so deadline tasks that expire there survive as a realistic backlog of
    // OVERDUE pending work at snapshot.
    if (clock.phase(day) !== "tail") await act.sweep(cutoff);
  }
}

/**
 * A next-day slot for a rescheduled task. Spreads picks across the first few free
 * slots so reschedules don't all pile onto the same work-start instant (which
 * produced unrealistic 4–5-deep conflict stacks); a small fraction still land on
 * work-start — the occasional genuine double-book keeping a shallow (≈2–3)
 * conflict level rather than none.
 */
async function nextDaySlot(
  act: Actuator,
  persona: Persona,
  task: DueTask,
  clock: SimClock,
  day: number,
  rng: Rng,
): Promise<Date | null> {
  const startNext = clock.at(
    day + 1,
    persona.prefs.workStart,
    persona.prefs.timezone,
  );
  // Don't push past a deadline.
  if (task.deadline && startNext.getTime() > task.deadline.getTime())
    return null;
  // ~18%: drop it straight on work-start without checking occupancy.
  if (rng.bool(0.18)) return startNext;
  const feasible = await act.feasible(task.id, startNext);
  if (feasible.length === 0) return startNext; // fully booked → let it conflict
  const k = rng.int(Math.min(feasible.length, 6));
  return feasible[k];
}

// ───────────────────────────── service actuator ────────────────────────────

/** Occupied future intervals for the persona's other placed PENDING tasks. */
function occupiedOf(tasks: Task[], excludeId: string): Interval[] {
  return tasks
    .filter((t) => t.id !== excludeId && t.scheduledStartTime !== null)
    .map((t) => intervalOf(t))
    .filter((i): i is Interval => i !== null);
}

/** Drives the REAL services + Prisma (the literal production telemetry path). */
class ServiceActuator implements Actuator {
  constructor(
    private readonly persona: Persona,
    private readonly tasks: TasksService,
    private readonly abandoned: AbandonedTasksService,
    private readonly prisma: PrismaService,
  ) {}

  private reloadUser(): Promise<User> {
    return this.prisma.user.findUniqueOrThrow({
      where: { id: this.persona.userId },
    });
  }

  async create(input: CreateTaskInput, now: Date) {
    const user = await this.reloadUser();
    const res: CreateTaskResponse = await this.tasks.create(input, user, now);
    return {
      placedAt: res.schedulingMeta.placedAt
        ? new Date(res.schedulingMeta.placedAt)
        : null,
      overflow: res.overflow ?? null,
      taskId: res.task.id,
    };
  }

  async resolveOverflow(
    taskId: string,
    choice: "outsideHours" | "nextAvailable",
    view: ViewMode,
    now: Date,
  ): Promise<void> {
    try {
      await this.tasks.resolveOverflow(
        taskId,
        { choice, view },
        await this.reloadUser(),
        now,
      );
    } catch {
      /* option no longer feasible — leave unplaced */
    }
  }

  async feasible(taskId: string, now: Date): Promise<Date[]> {
    const task = await this.prisma.task.findUniqueOrThrow({
      where: { id: taskId },
    });
    const others = await this.prisma.task.findMany({
      where: { userId: this.persona.userId, status: "PENDING" },
    });
    const occupied = occupiedOf(others, task.id);
    const earliest = task.deadline
      ? undefined
      : (task.schedulingAnchor ?? undefined);
    return feasibleSlots(
      this.persona.prefs,
      task.durationMinutes,
      task.deadline,
      occupied,
      now,
      earliest,
    );
  }

  async readTask(taskId: string) {
    const t = await this.prisma.task.findUnique({
      where: { id: taskId },
      select: { scheduledStartTime: true, durationMinutes: true },
    });
    return t ?? null;
  }

  async reschedule(taskId: string, to: Date, now: Date): Promise<void> {
    await this.tasks.reschedule(
      taskId,
      to.toISOString(),
      await this.reloadUser(),
      now,
    );
  }

  async resize(
    taskId: string,
    start: Date,
    dur: number,
    now: Date,
  ): Promise<void> {
    await this.tasks.resize(
      taskId,
      start.toISOString(),
      dur,
      await this.reloadUser(),
      now,
    );
  }

  async duePending(cutoff: Date): Promise<DueTask[]> {
    const rows = await this.prisma.task.findMany({
      where: {
        userId: this.persona.userId,
        status: "PENDING",
        scheduledStartTime: { not: null, lte: cutoff },
      },
      select: {
        id: true,
        scheduledStartTime: true,
        durationMinutes: true,
        deadline: true,
      },
    });
    return rows;
  }

  async complete(taskId: string, now: Date): Promise<void> {
    await this.tasks.complete(taskId, await this.reloadUser(), now);
  }

  async sweep(now: Date): Promise<void> {
    await this.abandoned.sweep(now, this.persona.userId);
  }
}

// ───────────────────────────── batched actuator ────────────────────────────

/** Drives an in-memory {@link PersonaState} (no DB until the bulk flush). */
class BatchedActuator implements Actuator {
  constructor(private readonly state: PersonaState) {}

  create(input: CreateTaskInput, now: Date) {
    return this.state.create(input, now);
  }
  resolveOverflow(
    taskId: string,
    choice: "outsideHours" | "nextAvailable",
    view: ViewMode,
    now: Date,
  ): void {
    this.state.resolveOverflow(taskId, choice, view, now);
  }
  feasible(taskId: string, now: Date): Date[] {
    return this.state.feasible(taskId, now);
  }
  readTask(taskId: string) {
    return this.state.readTask(taskId) ?? null;
  }
  reschedule(taskId: string, to: Date, now: Date): void {
    this.state.reschedule(taskId, to, now);
  }
  resize(taskId: string, start: Date, dur: number, now: Date): void {
    this.state.resize(taskId, start, dur, now);
  }
  duePending(cutoff: Date): DueTask[] {
    return this.state.duePending(cutoff);
  }
  complete(taskId: string, now: Date): void {
    this.state.complete(taskId, now);
  }
  sweep(now: Date): void {
    this.state.sweep(now);
  }
}

// ─────────────────────────────── orchestration ─────────────────────────────

/** Population-wide holidays sprinkled across the span (shared, read-only). */
function sampleHolidays(seed: number, days: number): Set<number> {
  const rng = makeRng(seedFor(seed, 777));
  const holidays = new Set<number>();
  const n = Math.max(1, Math.round(days / 60));
  for (let i = 0; i < n; i++) holidays.add(rng.int(days));
  return holidays;
}

async function tallyEvents(
  prisma: PrismaService,
): Promise<Record<string, number>> {
  const rows = await prisma.taskEvent.groupBy({
    by: ["eventType"],
    _count: { _all: true },
  });
  const out: Record<string, number> = {};
  for (const r of rows) out[r.eventType] = r._count._all;
  return out;
}

/** Run the whole population over the span. */
export async function runSimulation(opts: RunOptions): Promise<RunResult> {
  const mode: SimMode = opts.mode ?? "batched";
  const clock = new SimClock(opts.start, opts.days);
  const planned = plannedPersonas(opts.personaLimit);
  const holidays = sampleHolidays(opts.seed, opts.days);

  logger.log(
    `Seeding ${planned.length} personas, span ${opts.days}d from ${opts.start} ` +
      `(seed ${opts.seed}, reranker ${opts.reranker}, mode ${mode})`,
  );

  const result =
    mode === "batched"
      ? await runBatched(opts, clock, planned, holidays)
      : await runService(opts, clock, planned, holidays);

  const eventCounts = await tallyEvents(opts.prisma);
  logger.log(`Done. Events: ${JSON.stringify(eventCounts)}`);
  return { ...result, eventCounts };
}

/** In-memory engine → bulk write (default). Flushes per persona to bound memory. */
async function runBatched(
  opts: RunOptions,
  clock: SimClock,
  planned: { archetype: ArchetypeId; index: number }[],
  holidays: Set<number>,
): Promise<Omit<RunResult, "eventCounts">> {
  const personas: RunResult["personas"] = [];
  const groundTruth: PersonaGroundTruth[] = [];
  for (const p of planned) {
    const a = archetypeById(p.archetype);
    const rec = buildPersonaRecord(
      a,
      seedFor(opts.seed, p.index, 1),
      p.index,
      opts.days,
    );
    const state = new PersonaState(
      rec.persona.userId,
      rec.persona.prefs,
      rec.tagNames,
      opts.reranker,
    );
    await drivePersona(
      new BatchedActuator(state),
      rec.persona,
      clock,
      holidays,
      makeRng(seedFor(opts.seed, p.index, 2)),
      opts.days,
    );
    const output: PersonaOutput = { user: rec.user, state };
    await bulkWrite(opts.prisma, [output]);
    personas.push({
      userId: rec.persona.userId,
      archetypeId: rec.persona.archetypeId,
      index: rec.persona.index,
    });
    groundTruth.push(toGroundTruth(rec.persona));
    logger.log(`Seeded persona ${personas.length}/${planned.length}`);
  }
  return {
    personas,
    labels: personas.map((p) => ({
      userId: p.userId,
      archetypeId: p.archetypeId,
    })),
    groundTruth,
  };
}

/** Literal production path: seed users to DB, then drive the real services. */
async function runService(
  opts: RunOptions,
  clock: SimClock,
  planned: { archetype: ArchetypeId; index: number }[],
  holidays: Set<number>,
): Promise<Omit<RunResult, "eventCounts">> {
  // The Phase-2 placement re-rank + duration correction live in the pure core and
  // are threaded through the BATCHED engine here. In `--mode=service`, placement
  // goes through the real `TasksService`/`SchedulerService`, whose live Phase-2
  // wiring is the backend-engineer's scope; until that lands, a `phase2`
  // service-mode run would silently behave like `identity`. Fail loudly rather
  // than report a misleading A/B — run Phase-2 arms in the default batched mode.
  if (opts.reranker === "phase2") {
    throw new Error(
      "--reranker=phase2 is wired through the batched engine; run Phase-2 arms with --mode=batched " +
        "(service-mode Phase-2 depends on the live SchedulerService wiring).",
    );
  }
  const personas: Persona[] = [];
  for (const p of planned) {
    const a = archetypeById(p.archetype);
    personas.push(
      await seedPersona(
        opts.prisma,
        a,
        seedFor(opts.seed, p.index, 1),
        p.index,
        opts.days,
      ),
    );
  }

  const concurrency = Math.max(1, opts.concurrency ?? 1);
  for (let i = 0; i < personas.length; i += concurrency) {
    const batch = personas.slice(i, i + concurrency);
    await Promise.all(
      batch.map((persona) =>
        drivePersona(
          new ServiceActuator(persona, opts.tasks, opts.abandoned, opts.prisma),
          persona,
          clock,
          holidays,
          makeRng(seedFor(opts.seed, persona.index, 2)),
          opts.days,
        ),
      ),
    );
    logger.log(
      `Driven ${Math.min(i + concurrency, personas.length)}/${personas.length} personas`,
    );
  }

  return {
    personas: personas.map((p) => ({
      userId: p.userId,
      archetypeId: p.archetypeId,
      index: p.index,
    })),
    labels: personas.map((p) => ({
      userId: p.userId,
      archetypeId: p.archetypeId,
    })),
    groundTruth: personas.map(toGroundTruth),
  };
}

// Re-exported for the entry point / tests.
export { ARCHETYPES };
