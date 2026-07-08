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
import { driftedFieldFor } from "./personas/preference-field";

/**
 * Span days per "month" for drift accounting. `driftPerMonth.peakShiftBlocks` is
 * defined per 30-day month, so the elapsed-months factor the reaction loop drifts
 * by is `day / 30`.
 */
const DAYS_PER_MONTH = 30;

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

/**
 * Multi-tag duration-bias resolution (Step-8 ablation; `--duration-bias`):
 *  - `blend` — sample-weighted blend Σ(nₜ·bₜ)/Σ(nₜ) (the DEFAULT, heuristic §Phase 2).
 *  - `max`   — Conservative Max-Bias: take the largest multiplier (over-reserves →
 *    schedule inflation). The §8 discriminator cohort is `ops` (near-unbiased
 *    means, high variance). Only affects the `phase2` arm; `identity` never
 *    corrects durations.
 */
export type DurationBiasMode = "blend" | "max";

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
   * Optional per-cohort cap: keep the FIRST N personas of EACH archetype. Unlike
   * {@link personaLimit} (which slices the flat ordered list and would drop later
   * cohorts), this keeps every archetype represented — required by the Step-6
   * per-persona Wilcoxon and the Step-7 "no cohort regresses" guardrail. When both
   * are set, the per-cohort cap is applied first, then `personaLimit` truncates.
   */
  perCohortLimit?: number;
  /**
   * Service path only: how many personas to drive CONCURRENTLY. Personas own
   * disjoint `User` rows + independent seeded RNG streams, so a batch only
   * interleaves DB I/O. Defaults to 1. (Ignored by the batched path, which is
   * in-memory + CPU-bound and bulk-writes per persona.)
   */
  concurrency?: number;
  /** Persistence strategy. Defaults to `batched`. */
  mode?: SimMode;
  /**
   * Step-8 multi-tag duration-bias resolution. Defaults to `blend` (today's
   * behavior). Only affects the `phase2` arm's duration preprocessing.
   */
  durationBias?: DurationBiasMode;
  /**
   * Step-8 sensitivity: scales each persona's drawn noise floor ε (kept clamped
   * to [0, 1]). Defaults to `1.0` (no scaling).
   */
  noiseMult?: number;
  /**
   * Step-8 sensitivity: scales drift magnitude (peak shift + bias decay per
   * month). Defaults to `1.0` (no scaling).
   */
  driftMult?: number;
  /**
   * Softmax/Boltzmann temperature for the `phase2` placement re-ranker. Higher =
   * more exploration; a tiny value (e.g. `1e-6`) recovers the GREEDY argmax
   * Phase-2 (the pre-softmax behaviour). Defaults to the core
   * {@link RERANKER_TEMPERATURE}. Only affects the `phase2` arm.
   */
  temperature?: number;
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
  readTaskTags(taskId: string): Awaitable<string[]>;
  reschedule(taskId: string, to: Date, now: Date): Awaitable<void>;
  resize(taskId: string, start: Date, dur: number, now: Date): Awaitable<void>;
  duePending(cutoff: Date): Awaitable<DueTask[]>;
  complete(taskId: string, now: Date): Awaitable<void>;
  sweep(now: Date): Awaitable<void>;
}

// ─────────────────────────────── helpers ───────────────────────────────────

/**
 * Build the ordered list of (archetype, index) to seed.
 *
 * `index` is the GLOBAL population index (the per-persona seed key) and is
 * assigned over the full POPULATION first, so capping does NOT renumber the
 * personas that survive — a `dev` persona keeps the same seed (hence identical
 * latent draws + telemetry) whether or not the cohort cap is applied.
 *
 * `perCohortLimit` keeps only the first N personas of EACH archetype (every
 * cohort survives), then `limit` truncates the flat result.
 */
export function plannedPersonas(
  limit?: number,
  perCohortLimit?: number,
): { archetype: ArchetypeId; index: number }[] {
  const out: { archetype: ArchetypeId; index: number }[] = [];
  let idx = 0;
  for (const p of POPULATION) {
    let kept = 0;
    for (let i = 0; i < p.count; i++) {
      const index = idx++;
      if (perCohortLimit !== undefined && kept >= perCohortLimit) continue;
      out.push({ archetype: p.archetype, index });
      kept++;
    }
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

/**
 * Drive a single persona across the full span through the {@link Actuator}.
 * Returns the set of task IDs that were urgency-spike-moved (§5.6), for the
 * ground-truth sidecar's MAR decomposition.
 */
async function drivePersona(
  act: Actuator,
  persona: Persona,
  clock: SimClock,
  holidays: Set<number>,
  rng: Rng,
  days: number,
): Promise<Set<string>> {
  // Energy model (§5.5): replaces the old `recentLoad` scalar.
  // Initialised to the persona's resting baseline.
  let energyT = persona.energyBaseline;

  // Urgency-moved task IDs (§5.6): accumulated and returned for the sidecar.
  const urgencyMovedIds = new Set<string>();

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
      // Score against the drifted field for this point in the span so slow
      // non-stationary drift (`driftPerMonth` / `--drift-mult`) actually reaches
      // the reaction loop. `driftedFieldFor` is pure (no RNG), so the seeded
      // random stream is untouched and a zero-drift persona is unchanged.
      const driftedField = driftedFieldFor(
        persona.field,
        persona.driftPerMonth.peakShiftBlocks,
        day / DAYS_PER_MONTH,
      );
      const move = decidePlacement(
        persona,
        rt,
        suggested,
        feasible,
        rng,
        driftedField,
      );
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
      // Energy model (§5.5): pass `1 - energyT` as fatigue so high energy →
      // low fatigue → more completions (the existing fatigue logic captures this).
      const fatigue = 1 - energyT;
      const outcome = decideOutcome(persona, t, cutoff, fatigue, rng);
      if (outcome === "complete") {
        // Finished — but real users only TICK OFF a fraction of finished work,
        // so a chunk stays PENDING (revisited later). This is why a realistic
        // board shows lots of done-but-unmarked tasks lingering.
        if (!rng.bool(persona.markCompleteRate)) {
          // Effort spent, just not marked — deplete energy accordingly.
          energyT = Math.max(0, energyT - t.durationMinutes / 600);
          continue;
        }
        const completionAt = new Date(
          t.scheduledStartTime!.getTime() + t.durationMinutes * 60_000,
        );

        // Task splitting (§5.7): long tasks may be split into a partial
        // completion + a remainder task queued for the next day.
        if (
          t.durationMinutes >= persona.splitThresholdMinutes &&
          rng.bool(persona.splitRate)
        ) {
          const dPartial = round15(
            t.durationMinutes * (0.3 + rng.next() * 0.4),
          );
          const dRemainder = t.durationMinutes - dPartial;
          if (dPartial >= 15 && dRemainder >= 15) {
            // RESIZE down to the partial duration, then complete.
            await act.resize(t.id, t.scheduledStartTime!, dPartial, cutoff);
            await act.complete(t.id, completionAt);
            // Re-queue remainder as a new task for the next day.
            const tags = await act.readTaskTags(t.id);
            const nextDayStart = clock.at(
              day + 1,
              persona.prefs.workStart,
              persona.prefs.timezone,
            );
            try {
              await act.create(
                {
                  title: "Remainder (split)",
                  durationMinutes: dRemainder,
                  tags,
                  view: "day",
                  startDate: nextDayStart.toISOString().slice(0, 10),
                },
                nextDayStart,
              );
            } catch {
              /* remainder create failure is non-fatal */
            }
            energyT = Math.max(0, energyT - dPartial / 600);
            continue;
          }
        }

        await act.complete(t.id, completionAt);
        // Deplete energy by effort expended (§5.5).
        energyT = Math.max(0, energyT - t.durationMinutes / 600);
      } else if (outcome === "reschedule") {
        const next = await nextDaySlot(act, persona, t, clock, day, rng);
        if (next) await act.reschedule(t.id, next, cutoff);
        // Small energy cost from context-switching / rescheduling overhead.
        energyT = Math.max(0, energyT - 0.03);
      }
      // 'abandon' is left to the overdue sweep below.
    }

    // Energy overnight recovery (§5.5): partial reset toward baseline.
    // Formula: energyT = min(1, baseline + 0.8 * (baseline - energyT))
    // which means if energyT < baseline, it moves 80% of the gap toward baseline.
    energyT = Math.min(
      1,
      persona.energyBaseline + 0.8 * (persona.energyBaseline - energyT),
    );

    // Urgency spikes (§5.6): after settling outcomes, each still-PENDING task
    // has a small chance of receiving an urgency spike. When it fires, the task
    // is pulled forward to the earliest feasible slot that precedes the current
    // slot. The resulting MOVE is tagged in `urgencyMovedIds` for the sidecar.
    const urgencyNow = clock.endOf(day, persona.prefs.timezone);
    const pending = await act.duePending(
      new Date(urgencyNow.getTime() + 365 * 24 * 60 * 60_000), // all future pending
    );
    for (const t of pending) {
      if (!rng.bool(persona.urgencySpikeProbPerTask)) continue;
      const slots = await act.feasible(t.id, urgencyNow);
      if (slots.length === 0) continue;
      const currentMs = t.scheduledStartTime?.getTime() ?? Infinity;
      // Find the earliest feasible slot strictly before the current placement.
      const sooner = slots.find((s) => s.getTime() < currentMs);
      if (!sooner) continue;
      await act.reschedule(t.id, sooner, urgencyNow);
      urgencyMovedIds.add(t.id);
    }

    // ABANDON deadline-expired PENDING tasks. Held back during the held-out TAIL
    // so deadline tasks that expire there survive as a realistic backlog of
    // OVERDUE pending work at snapshot.
    if (clock.phase(day) !== "tail") await act.sweep(cutoff);
  }

  return urgencyMovedIds;
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
    return feasibleSlots(
      this.persona.prefs,
      task.durationMinutes,
      task.deadline,
      occupied,
      now,
    );
  }

  async readTask(taskId: string) {
    const t = await this.prisma.task.findUnique({
      where: { id: taskId },
      select: { scheduledStartTime: true, durationMinutes: true },
    });
    return t ?? null;
  }

  async readTaskTags(taskId: string): Promise<string[]> {
    const t = await this.prisma.task.findUnique({
      where: { id: taskId },
      select: { tags: { select: { name: true } } },
    });
    return t?.tags.map((tg) => tg.name) ?? [];
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
  readTaskTags(taskId: string): string[] {
    return this.state.readTaskTags(taskId);
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
  const planned = plannedPersonas(opts.personaLimit, opts.perCohortLimit);
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
      { noiseMult: opts.noiseMult, driftMult: opts.driftMult },
    );
    const state = new PersonaState(
      rec.persona.userId,
      rec.persona.prefs,
      rec.tagNames,
      opts.reranker,
      opts.durationBias ?? "blend",
      opts.temperature,
    );
    const urgencyMovedIds = await drivePersona(
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
    groundTruth.push(toGroundTruth(rec.persona, urgencyMovedIds));
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
        { noiseMult: opts.noiseMult, driftMult: opts.driftMult },
      ),
    );
  }

  const concurrency = Math.max(1, opts.concurrency ?? 1);
  // Per-persona urgency-moved sets, keyed by persona index for post-loop join.
  const urgencyByIndex = new Map<number, Set<string>>();
  for (let i = 0; i < personas.length; i += concurrency) {
    const batch = personas.slice(i, i + concurrency);
    const results = await Promise.all(
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
    batch.forEach((persona, j) =>
      urgencyByIndex.set(persona.index, results[j]),
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
    groundTruth: personas.map((p) =>
      toGroundTruth(p, urgencyByIndex.get(p.index)),
    ),
  };
}

// Re-exported for the entry point / tests.
export { ARCHETYPES };
