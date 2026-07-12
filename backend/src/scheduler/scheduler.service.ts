import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { SchedulingRationale } from "@zenflow/shared";
import { PrismaService } from "../prisma/prisma.service";
import { Prisma, type TaskEventType } from "../../generated/prisma";
import type {
  CascadeScope,
  EdfTask,
  Placement,
  SchedulerPrefs,
} from "./interfaces";
import { feasibleSlots, intervalOf, scheduleAll } from "./utils/edf";
import { MAX_SCAN_DAYS } from "./constants";
import { topN as rerankTopN } from "./utils/reranker";
import {
  applyOverflowChoice,
  computeOverflowOptions as computeOverflowOptionsPure,
  findNextAvailableSlot,
  findSlotIgnoringWorkHours,
} from "./utils/overflow";
import { buildRationale } from "./utils/rationale";
import {
  NEUTRAL_BIAS,
  blendBias,
  correctDuration,
  type TagBias,
} from "./utils/duration-bias";
import {
  EVENT_REWARD,
  applyPreferenceDeltas,
  buildSnapshot,
  recomputeConflicts,
  toEdfTask,
  type ConflictTask,
  type EdfSourceTask,
} from "./utils/telemetry";
import type { Interval } from "./utils/slot";

/** Either a live `PrismaService` or an open `$transaction` client. */
type Db = PrismaService | Prisma.TransactionClient;

/**
 * The ONLY layer that touches Prisma or writes telemetry (CLAUDE.md invariant
 * #2). Every pure scheduling decision is delegated to `edf.ts` / `reranker.ts`
 * / `overflow.ts` / `rationale.ts` / `duration-bias.ts`; this service loads
 * rows, calls the pure core, diffs the result against the DB, and persists.
 */
@Injectable()
export class SchedulerService {
  constructor(private readonly prisma: PrismaService) {}

  /** Map a user's schedule columns to the pure core's {@link SchedulerPrefs}. */
  prefsOf(user: {
    workStart: number;
    workEnd: number;
    workDays: number[];
    timezone: string;
  }): SchedulerPrefs {
    return {
      workStart: user.workStart,
      workEnd: user.workEnd,
      workDays: user.workDays,
      timezone: user.timezone,
    };
  }

  /**
   * Aggregate this user's per-tag duration-bias evidence `{n, b}` from
   * COMPLETE/KEEP `TaskEvent` telemetry, pairing each outcome with its CREATE
   * estimate by taskId. Keyed by tag name so callers can attribute evidence
   * back to a specific tag. Single source of truth reused by both
   * {@link computeDurationCorrection} and `UsersService.getUserTagBias` (which
   * needs the tag names; `computeDurationCorrection` only needs the values).
   */
  async aggregateTagBias(
    userId: string,
    tags: string[],
    db: Db = this.prisma,
  ): Promise<Map<string, TagBias>> {
    if (tags.length === 0) return new Map();
    const wanted = new Set(tags);

    const events = await db.taskEvent.findMany({
      where: { userId, eventType: { in: ["CREATE", "COMPLETE", "KEEP"] } },
      select: { taskId: true, eventType: true, newSnapshot: true },
      orderBy: { occurredAt: "desc" },
      take: 2000,
    });

    type Snap = { durationMinutes?: number; tags?: string[] };
    const estimateByTask = new Map<string, number>();
    const outcomes: { taskId: string; duration: number; tags: string[] }[] = [];
    for (const e of events) {
      const snap = (e.newSnapshot ?? {}) as Snap;
      const dur =
        typeof snap.durationMinutes === "number" ? snap.durationMinutes : null;
      const tgs = Array.isArray(snap.tags) ? snap.tags : [];
      if (dur === null) continue;
      if (e.eventType === "CREATE") {
        if (!estimateByTask.has(e.taskId)) estimateByTask.set(e.taskId, dur);
      } else {
        outcomes.push({ taskId: e.taskId, duration: dur, tags: tgs });
      }
    }

    const acc = new Map<string, { sum: number; n: number }>();
    for (const o of outcomes) {
      const estimated = estimateByTask.get(o.taskId);
      if (!estimated || estimated <= 0) continue;
      const ratio = o.duration / estimated;
      for (const tag of o.tags) {
        if (!wanted.has(tag)) continue;
        const cur = acc.get(tag) ?? { sum: 0, n: 0 };
        cur.sum += ratio;
        cur.n += 1;
        acc.set(tag, cur);
      }
    }
    return new Map(
      [...acc.entries()].map(([tag, { sum, n }]) => [tag, { n, b: sum / n }]),
    );
  }

  /**
   * ALWAYS computed (so the bias table keeps learning even in `never` mode) —
   * the CALLER decides whether to apply `adjustedDuration` based on the user's
   * `durationAdjustmentMode`.
   */
  async computeDurationCorrection(
    userId: string,
    tags: string[],
    estimatedMin: number,
    db: Db = this.prisma,
  ): Promise<{
    estimatedDuration: number;
    adjustedDuration: number;
    biasApplied: number;
    durationReason: string | null;
  }> {
    const perTag = await this.aggregateTagBias(userId, tags, db);
    const bias = blendBias([...perTag.values()]);
    const adjustedDuration = correctDuration(estimatedMin, bias);
    const durationReason =
      bias !== NEUTRAL_BIAS && tags.length > 0
        ? `#${tags[0]} ~${Math.round(Math.abs(bias - 1) * 100)}% ${
            bias > 1 ? "longer" : "shorter"
          }`
        : null;
    return {
      estimatedDuration: estimatedMin,
      adjustedDuration,
      biasApplied: bias,
      durationReason,
    };
  }

  /** This user's PENDING tasks, in the shape the pure core consumes. */
  private async loadPendingRows(
    userId: string,
    db: Db,
    ceiling: Date,
    now = new Date(),
  ): Promise<EdfSourceTask[]> {
    return db.task.findMany({
      where: {
        userId,
        status: { not: "DONE" },
        OR: [
          { scheduledStartTime: null },
          { scheduledStartTime: { gte: now, lte: ceiling } },
        ],
      },
      select: {
        id: true,
        durationMinutes: true,
        deadline: true,
        manuallyMoved: true,
        scheduledStartTime: true,
        createdAt: true,
        conflict: true,
      },
    });
  }

  /**
   * The single cascade primitive behind every mutation: create, deadline/tag
   * confirm, delete gap-fill, drag, resize. Loads this user's PENDING tasks,
   * runs the pure EDF core, recomputes true pairwise-overlap conflicts across
   * the projected result (so e.g. two manually-moved tasks that now overlap
   * are flagged even though `scheduleAll` never reorders them), diffs against
   * the DB, and writes back every CHANGED row in one pass (including a bare
   * conflict-flag flip). Returns only the placements that actually moved or
   * lost their manual pin — what callers report as `displaced` — so a task
   * whose slot didn't change doesn't get reported as "moved to make room"
   * just because another task was dragged on/off of it.
   */
  async cascadeReschedule(
    userId: string,
    prefs: SchedulerPrefs,
    scope: CascadeScope,
    db: Db = this.prisma,
  ): Promise<Placement[]> {
    // The freeze WINDOW (`scope`) decides which loaded tasks are movable vs.
    // frozen — it must NOT bound which rows we load. Placed tasks beyond
    // `windowEnd` are frozen occupied space the movable set has to avoid, so we
    // load the full scan horizon regardless of the window. In particular a
    // zero-width create window (`windowStart === windowEnd`) would otherwise
    // load nothing but unplaced tasks, leaving `occupied` empty and dropping
    // the new task straight on top of already-placed ones.
    const loadCeiling = new Date(
      Math.max(
        scope.windowEnd.getTime(),
        scope.windowStart.getTime() + MAX_SCAN_DAYS * 24 * 60 * 60 * 1000,
      ),
    );
    const rows = await this.loadPendingRows(
      userId,
      db,
      loadCeiling,
      scope.windowStart,
    );
    const edfTasks = rows.map(toEdfTask);
    const user = await db.user.findUniqueOrThrow({
      where: { id: userId },
      select: { preferenceMatrix: true },
    });
    const placements = scheduleAll(
      prefs,
      edfTasks,
      scope,
      user.preferenceMatrix,
    );

    const byId = new Map(rows.map((r) => [r.id, r]));
    const projected: ConflictTask[] = placements.map((p) => ({
      id: p.id,
      scheduledStartTime: p.scheduledStartTime,
      durationMinutes: byId.get(p.id)!.durationMinutes,
      conflict: p.conflict,
    }));
    const conflictOf = recomputeConflicts(projected);

    const occurredAt = new Date();
    const events: Prisma.TaskEventCreateManyArgs["data"] = [];
    const changed: Placement[] = [];
    for (const p of placements) {
      const row = byId.get(p.id)!;
      const finalConflict = conflictOf.get(p.id) ?? p.conflict;
      const prevTime = row.scheduledStartTime?.getTime() ?? null;
      const nextTime = p.scheduledStartTime?.getTime() ?? null;
      const timeChanged = prevTime !== nextTime;
      const manualChanged = row.manuallyMoved !== p.manuallyMoved;
      const conflictChanged = row.conflict !== finalConflict;
      if (timeChanged || conflictChanged || manualChanged) {
        const placement: Placement = {
          id: p.id,
          scheduledStartTime: p.scheduledStartTime,
          conflict: finalConflict,
          manuallyMoved: p.manuallyMoved,
          propensity: p.propensity,
        };
        // Only report this placement to the caller (== a "displaced" entry,
        // shown to the user as "moved to make room") when the task actually
        // moved. A bare conflict-flag flip — e.g. dragging a different task
        // on/off of this one's slot — changes nothing about THIS task and
        // must still be persisted below, but surfacing it as "displaced"
        // would tell the user a task moved when it didn't.
        if (timeChanged || manualChanged) changed.push(placement);
        await db.task.update({
          where: { id: p.id },
          data: {
            scheduledStartTime: p.scheduledStartTime,
            conflict: finalConflict,
            manuallyMoved: p.manuallyMoved,
          },
        });

        // The ranker actually chose this slot for a movable task (not a
        // frozen pass-through) — log it, UNLESS it's `scope.fixedTaskId`: that
        // task's own placement decision is the caller's to log (CREATE at
        // tasks.service.ts, or an explicit RESCHEDULED at the
        // reschedule-cascade call site) so it isn't double-recorded here.
        if (p.propensity !== undefined && p.id !== scope.fixedTaskId) {
          events.push({
            taskId: p.id,
            userId,
            eventType: "RESCHEDULED",
            oldSnapshot: buildSnapshot({
              scheduledStartTime: row.scheduledStartTime,
              durationMinutes: row.durationMinutes,
            }),
            newSnapshot: buildSnapshot(
              {
                scheduledStartTime: p.scheduledStartTime,
                durationMinutes: row.durationMinutes,
              },
              [],
              undefined,
              p.propensity,
            ),
            rewardScore: EVENT_REWARD.RESCHEDULED,
            occurredAt,
          });
        }
      }
    }
    if (events.length > 0) await db.taskEvent.createMany({ data: events });
    return changed;
  }

  /**
   * Read-only dry-run of the scheduler for a not-yet-created task: never
   * writes to the DB. Builds `occupied` from the user's currently-placed
   * tasks, computes the draft task's feasible set, re-ranks it by the user's
   * preference matrix, and attaches a rationale per candidate.
   */
  async simulate(
    userId: string,
    prefs: SchedulerPrefs,
    draft: { durationMinutes: number; deadline: Date; tags?: string[] },
    now: Date,
    topN = 1,
  ): Promise<{
    proposals: {
      scheduledStartTime: Date;
      rationale: SchedulingRationale | null;
    }[];
  }> {
    const rows = await this.loadPendingRows(
      userId,
      this.prisma,
      draft.deadline,
      now,
    );
    const occupied = rows
      .map((r) => intervalOf(toEdfTask(r)))
      .filter((iv): iv is Interval => iv !== null);

    const draftTask: EdfTask = {
      id: "__draft__",
      durationMinutes: draft.durationMinutes,
      deadline: draft.deadline,
      manuallyMoved: false,
      scheduledStartTime: null,
      createdAt: now,
      conflict: false,
    };

    const candidates = feasibleSlots(draftTask, now, prefs, occupied);
    if (candidates.length === 0) return { proposals: [] };

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { preferenceMatrix: true },
    });
    const n = Math.max(1, Math.min(5, topN));
    const ranked = rerankTopN(
      candidates,
      user.preferenceMatrix,
      prefs.timezone,
      draftTask.id,
      n,
    );

    return {
      proposals: ranked.map((r) => ({
        scheduledStartTime: r.start,
        rationale: buildRationale(
          r.start,
          user.preferenceMatrix,
          prefs.timezone,
        ),
      })),
    };
  }

  /** Both overflow-recovery options for a task that couldn't be placed. */
  async computeOverflowOptions(
    userId: string,
    task: { id: string; durationMinutes: number; deadline: Date },
    prefs: SchedulerPrefs,
    now: Date,
    db: Db = this.prisma,
  ): Promise<{
    outsideHours: Interval | null;
    nextAvailable: Interval | null;
  }> {
    const rows = await this.loadPendingRows(userId, db, task.deadline, now);
    const occupied = rows
      .filter((r) => r.id !== task.id)
      .map((r) => intervalOf(toEdfTask(r)))
      .filter((iv): iv is Interval => iv !== null);
    const edfTask: EdfTask = {
      id: task.id,
      durationMinutes: task.durationMinutes,
      deadline: task.deadline,
      manuallyMoved: false,
      scheduledStartTime: null,
      createdAt: now,
      conflict: true,
    };
    return computeOverflowOptionsPure(edfTask, now, occupied, prefs);
  }

  /**
   * Persist the user's accepted overflow-recovery choice: computes the
   * concrete slot for `choice`, pins the task there (`manuallyMoved: true`),
   * auto-heals any secondary overflow it causes (see `overflow.ts`), writes
   * every changed row + one MOVE event per displaced task in a transaction.
   */
  async resolveOverflow(
    taskId: string,
    choice: "outsideHours" | "nextAvailable",
    userId: string,
    prefs: SchedulerPrefs,
    now: Date,
  ): Promise<{ task: Placement; displaced: Placement[] }> {
    return this.prisma.$transaction(async (tx) => {
      const { deadline } = await tx.task.findUniqueOrThrow({
        where: { id: taskId, userId },
        select: { deadline: true },
      }); // ensure the task exists and belongs to the user
      const isNightOwl = prefs.workStart > prefs.workEnd;
      const rows = await this.loadPendingRows(
        userId,
        tx,
        new Date(
          deadline!.getTime() + (isNightOwl ? 8 : 7) * 24 * 60 * 60 * 1000,
        ),
        now,
      );
      const byId = new Map(rows.map((r) => [r.id, r]));
      if (!byId.has(taskId))
        throw new NotFoundException(`Cannot find task with id ${taskId}`);

      const edfTasks = rows.map(toEdfTask);
      const targetEdf = edfTasks.find((t) => t.id === taskId)!;
      const occupied = edfTasks
        .filter((t) => t.id !== taskId)
        .map((t) => intervalOf(t))
        .filter((iv): iv is Interval => iv !== null);

      const chosenSlot =
        choice === "outsideHours"
          ? findSlotIgnoringWorkHours(targetEdf, now, occupied, prefs)
          : findNextAvailableSlot(
              targetEdf,
              targetEdf.deadline ?? now,
              occupied,
              prefs,
            );
      if (!chosenSlot)
        throw new BadRequestException(
          "No feasible recovery slot found within the scan horizon",
        );

      const { placements, displaced } = applyOverflowChoice(
        choice,
        targetEdf,
        chosenSlot,
        edfTasks,
        prefs,
        now,
      );
      const batch: Prisma.TaskEventCreateManyArgs["data"] = [];

      for (const p of placements) {
        const row = byId.get(p.id)!;
        const prevTime = row.scheduledStartTime?.getTime() ?? null;
        const nextTime = p.scheduledStartTime?.getTime() ?? null;
        const pinned = p.id === taskId;
        if (prevTime !== nextTime || row.conflict !== p.conflict || pinned) {
          await tx.task.update({
            where: { id: p.id },
            data: {
              scheduledStartTime: p.scheduledStartTime,
              conflict: p.conflict,
              ...(pinned ? { manuallyMoved: true } : {}),
            },
          });
        }
        if (pinned) {
          const oldSnapshot = buildSnapshot({
            scheduledStartTime: row.scheduledStartTime,
            durationMinutes: row.durationMinutes,
          });
          batch.push({
            taskId: p.id,
            userId,
            eventType: "MOVE",
            oldSnapshot,
            newSnapshot: buildSnapshot(
              {
                scheduledStartTime: p.scheduledStartTime,
                durationMinutes: row.durationMinutes,
              },
              [],
              row.scheduledStartTime,
            ),
            rewardScore: EVENT_REWARD.MOVE,
            occurredAt: now,
          });
        }
      }

      await tx.taskEvent.createMany({ data: batch });

      const targetPlacement = placements.find((p) => p.id === taskId)!;
      return {
        task: targetPlacement,
        displaced: displaced.filter((d) => d.id !== taskId),
      };
    });
  }

  /**
   * Record a telemetry event + (for the positive placement signals) nudge the
   * user's signed preference matrix. Reused by create/complete/drag/resize
   * call sites in `TasksService`.
   */
  async recordEvent(
    userId: string,
    taskId: string,
    eventType: TaskEventType,
    task: { scheduledStartTime: Date | null; durationMinutes: number },
    opts: {
      tags?: string[];
      suggestedStartTime?: Date | null;
      propensity?: number;
      oldSnapshot?: Prisma.InputJsonValue | null;
      occurredAt?: Date;
      previousScheduledStartTime?: Date | null;
    } = {},
    db: Db = this.prisma,
  ): Promise<void> {
    const reward = EVENT_REWARD[eventType];
    await db.taskEvent.create({
      data: {
        taskId,
        userId,
        eventType,
        oldSnapshot: opts.oldSnapshot ?? Prisma.JsonNull,
        newSnapshot: buildSnapshot(
          task,
          opts.tags ?? [],
          opts.suggestedStartTime,
          opts.propensity,
        ),
        rewardScore: reward,
        occurredAt: opts.occurredAt ?? new Date(),
      },
    });

    // Nudge the preference matrix on placement-acceptance signals, OR — when a
    // real drag/resize actually moved the slot — a two-sided dislike-old /
    // prefer-new nudge (docs/heuristic.md §Signals tracked: a genuine drag is
    // TWO signals at once).
    const previous = opts.previousScheduledStartTime;
    const twoSided =
      task.scheduledStartTime !== null &&
      previous != null &&
      previous.getTime() !== task.scheduledStartTime.getTime();
    const singleSidedEligible =
      eventType === "KEEP" || eventType === "COMPLETE" || eventType === "MOVE";

    if (task.scheduledStartTime && (twoSided || singleSidedEligible)) {
      const user = await this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { preferenceMatrix: true, timezone: true },
      });
      const deltas = twoSided
        ? [
            { at: previous, delta: -1.0 },
            { at: task.scheduledStartTime, delta: 1.0 },
          ]
        : [{ at: task.scheduledStartTime, delta: reward }];
      const updated = applyPreferenceDeltas(
        user.preferenceMatrix,
        deltas,
        user.timezone,
      );
      await db.user.update({
        where: { id: userId },
        data: { preferenceMatrix: updated },
      });
    }
  }
}
