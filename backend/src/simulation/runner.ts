import { Logger } from "@nestjs/common";
import type { PrismaService } from "../prisma/prisma.service";
import type { TasksService } from "../tasks/tasks.service";
import type { SchedulerService } from "../scheduler/scheduler.service";
import type { AbandonedTasksService } from "../scheduler/abandoned-tasks.service";
import type { CreateTaskDto } from "../tasks/dto/create-task.dto";
import type { ResolveOverflowDto } from "../tasks/dto/resolve-overflow.dto";
import type { Task, User } from "../../generated/prisma";
import type { CreateTaskResponse } from "@zenflow/shared";
import { feasibleSlots } from "../scheduler/edf";
import type { Interval } from "../scheduler/slot";
import { intervalOf } from "../scheduler/edf";
import { makeRng, seedFor, type Rng } from "./rng";
import { SimClock } from "./clock";
import {
  ARCHETYPES,
  POPULATION,
  archetypeById,
  type ArchetypeId,
} from "./personas/archetypes";
import { seedPersona, type Persona } from "./personas/persona.factory";
import { generateTasksForDay, type TaskSpec } from "./behavior/task-generator";
import {
  decideOutcome,
  decidePlacement,
  decideResize,
  type ReactionTask,
} from "./behavior/reaction.model";

/**
 * The closed-loop driver (seed doc §2.7). Per simulated day, per persona:
 * generate tasks → create them through the REAL TasksService → react (move /
 * resize) within the EDF feasible set → settle outcomes (complete / reschedule /
 * abandon). Every mutation flows through the production services so the telemetry
 * (TaskEvent rows, suggestedStartTime snapshots, signed preferenceMatrix) is
 * produced exactly as in production.
 *
 * Two disciplines from the seed doc are enforced here:
 *  - §1.1: a virtual `now` is threaded into every mutation so events spread
 *    across the simulated year and placement is relative to the simulated day.
 *  - §1.2: the `User` is RE-FETCHED before every matrix-mutating call
 *    (reschedule / resize / complete) so accumulated `preferenceMatrix` updates
 *    aren't clobbered by a stale cached object.
 */

export interface RunOptions {
  tasks: TasksService;
  scheduler: SchedulerService;
  abandoned: AbandonedTasksService;
  prisma: PrismaService;
  seed: number;
  start: string; // YYYY-MM-DD
  days: number;
  /** Only the Phase-1 identity re-ranker is wired today (seed doc §2.8). */
  reranker: "identity";
  /** Optional cap on personas (smoke runs); defaults to the full POPULATION. */
  personaLimit?: number;
}

export interface RunResult {
  personas: { userId: string; archetypeId: ArchetypeId; index: number }[];
  /** Out-of-band labels (ground truth) — never written to a learner-visible column. */
  labels: { userId: string; archetypeId: ArchetypeId }[];
  eventCounts: Record<string, number>;
}

const logger = new Logger("Simulation");

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

/** Re-fetch the user so accumulated preferenceMatrix isn't clobbered (§1.2). */
async function reloadUser(
  prisma: PrismaService,
  userId: string,
): Promise<User> {
  return prisma.user.findUniqueOrThrow({ where: { id: userId } });
}

/** Occupied future intervals for the persona's other placed PENDING tasks. */
function occupiedOf(tasks: Task[], excludeId: string): Interval[] {
  return tasks
    .filter((t) => t.id !== excludeId && t.scheduledStartTime !== null)
    .map((t) => intervalOf(t))
    .filter((i): i is Interval => i !== null);
}

/** Pure feasible-slot enumeration for `task`, mirroring the service's inputs. */
async function computeFeasible(
  prisma: PrismaService,
  persona: Persona,
  task: Task,
  now: Date,
): Promise<Date[]> {
  const others = await prisma.task.findMany({
    where: { userId: persona.userId, status: "PENDING" },
  });
  const occupied = occupiedOf(others, task.id);
  const earliest = task.deadline
    ? undefined
    : (task.schedulingAnchor ?? undefined);
  return feasibleSlots(
    persona.prefs,
    task.durationMinutes,
    task.deadline,
    occupied,
    now,
    earliest,
  );
}

function toCreateDto(spec: TaskSpec): CreateTaskDto {
  // The input is already CreateTaskInput-shaped; CreateTaskDto is structurally
  // the same (validated at the HTTP boundary, which the simulator bypasses).
  return spec.input;
}

function toReactionTask(spec: TaskSpec, task: Task): ReactionTask {
  return {
    tags: spec.tags,
    deadline: task.deadline,
    durationMinutes: task.durationMinutes,
    trueDurationMinutes: spec.trueDurationMinutes,
  };
}

/** Run the whole population over the span. */
export async function runSimulation(opts: RunOptions): Promise<RunResult> {
  const { tasks, abandoned, prisma } = opts;
  const clock = new SimClock(opts.start, opts.days);
  const planned = plannedPersonas(opts.personaLimit);

  // A handful of population-wide holidays sprinkled across the span.
  const holidayRng = makeRng(seedFor(opts.seed, 777));
  const holidays = new Set<number>();
  const nHolidays = Math.max(1, Math.round(opts.days / 60));
  for (let i = 0; i < nHolidays; i++) holidays.add(holidayRng.int(opts.days));

  logger.log(
    `Seeding ${planned.length} personas, span ${opts.days}d from ${opts.start} (seed ${opts.seed}, reranker ${opts.reranker})`,
  );

  // Seed all personas first (each gets an independent seeded stream).
  const personas: Persona[] = [];
  for (const p of planned) {
    const a = archetypeById(p.archetype);
    const persona = await seedPersona(
      prisma,
      a,
      seedFor(opts.seed, p.index, 1),
      p.index,
      opts.days,
    );
    personas.push(persona);
  }

  // Drive each persona independently (they own disjoint User rows).
  for (const persona of personas) {
    const rng = makeRng(seedFor(opts.seed, persona.index, 2));
    await drivePersona(opts, persona, clock, holidays, rng);
  }

  const labels = personas.map((p) => ({
    userId: p.userId,
    archetypeId: p.archetypeId,
  }));
  const eventCounts = await tallyEvents(prisma);
  void tasks; // tasks/abandoned used inside drivePersona; referenced here for clarity
  void abandoned;
  logger.log(`Done. Events: ${JSON.stringify(eventCounts)}`);

  return {
    personas: personas.map((p) => ({
      userId: p.userId,
      archetypeId: p.archetypeId,
      index: p.index,
    })),
    labels,
    eventCounts,
  };
}

/** Drive a single persona across the full span. */
async function drivePersona(
  opts: RunOptions,
  persona: Persona,
  clock: SimClock,
  holidays: Set<number>,
  rng: Rng,
): Promise<void> {
  const { tasks, abandoned, prisma } = opts;
  let recentLoad = 0; // rolling fatigue proxy

  for (let day = 0; day < opts.days; day++) {
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
      const user = await reloadUser(prisma, persona.userId);

      let res: CreateTaskResponse;
      try {
        res = await tasks.create(toCreateDto(spec), user, arriveAt);
      } catch (e) {
        logger.warn(`create failed for ${persona.userId}: ${String(e)}`);
        continue;
      }

      // Unplaced → maybe accept a recovery option, then move on.
      if (
        res.schedulingMeta.placedAt === null &&
        res.overflow &&
        rng.bool(persona.editPropensity)
      ) {
        const choice = res.overflow.outsideHours
          ? "outsideHours"
          : res.overflow.nextAvailable
            ? "nextAvailable"
            : null;
        if (choice) {
          const dto = {
            choice,
            view: spec.input.view ?? "day",
          } as ResolveOverflowDto;
          try {
            await tasks.resolveOverflow(
              res.task.id,
              dto,
              await reloadUser(prisma, persona.userId),
              arriveAt,
            );
          } catch {
            /* option no longer feasible — leave unplaced */
          }
        }
        continue;
      }
      if (res.schedulingMeta.placedAt === null) continue;

      // Placement channel: react to the suggested slot within the feasible set.
      const placed = await prisma.task.findUniqueOrThrow({
        where: { id: res.task.id },
      });
      const suggested = placed.scheduledStartTime!;
      const feasible = await computeFeasible(prisma, persona, placed, arriveAt);
      const rt = toReactionTask(spec, placed);
      const move = decidePlacement(persona, rt, suggested, feasible, rng);
      if (move) {
        await tasks.reschedule(
          res.task.id,
          move.toISOString(),
          await reloadUser(prisma, persona.userId),
          arriveAt,
        );
      }

      // Duration channel: resize toward the true duration when it mismatches.
      const newDur = decideResize(persona, rt, rng);
      if (newDur !== null) {
        const at = (move ?? suggested).toISOString();
        await tasks.resize(
          res.task.id,
          at,
          newDur,
          await reloadUser(prisma, persona.userId),
          arriveAt,
        );
      }
    }

    // Settle outcomes for tasks whose slot has passed by end-of-day.
    const cutoff = clock.endOf(day, persona.prefs.timezone);
    const due = await prisma.task.findMany({
      where: {
        userId: persona.userId,
        status: "PENDING",
        scheduledStartTime: { not: null, lte: cutoff },
      },
    });
    for (const t of due) {
      const fatigue = Math.min(1, recentLoad / 4);
      const outcome = decideOutcome(persona, t, cutoff, fatigue, rng);
      if (outcome === "complete") {
        const completionAt = new Date(
          t.scheduledStartTime!.getTime() + t.durationMinutes * 60_000,
        );
        await tasks.complete(
          t.id,
          await reloadUser(prisma, persona.userId),
          completionAt,
        );
        recentLoad += t.durationMinutes / 120;
      } else if (outcome === "reschedule") {
        const next = nextDaySlot(t, persona, clock, day);
        if (next) {
          await tasks.reschedule(
            t.id,
            next.toISOString(),
            await reloadUser(prisma, persona.userId),
            cutoff,
          );
        }
        recentLoad += 0.2;
      }
      // 'abandon' is left to the overdue sweep below.
    }
    recentLoad *= 0.6; // decay fatigue overnight

    // ABANDON deadline-expired PENDING tasks via the production sweep.
    await abandoned.sweep(cutoff);
  }
}

/** A simple next-day work-start slot for a rescheduled task (best-effort). */
function nextDaySlot(
  task: Task,
  persona: Persona,
  clock: SimClock,
  day: number,
): Date | null {
  // Don't push past a deadline.
  const candidate = clock.at(
    day + 1,
    persona.prefs.workStart,
    persona.prefs.timezone,
  );
  if (task.deadline && candidate.getTime() > task.deadline.getTime())
    return null;
  return candidate;
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

// Re-exported for the entry point / tests.
export { ARCHETYPES };
