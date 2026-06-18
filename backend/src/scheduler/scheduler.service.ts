import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { Prisma, type Task, type User } from "../../generated/prisma";
import {
  PREFERENCE_MATRIX_LENGTH,
  type OverflowGranularity,
  type SchedulingOverflow,
} from "@zenflow/shared";
import {
  type EdfTask,
  hasElapsed,
  intervalOf,
  isPast,
  scheduleAll,
  type SchedulerPrefs,
} from "./edf";
import { type Interval, SLOT_MS, localDateStr, preferenceIndex } from "./slot";
import { findNextAvailableSlot, findSlotIgnoringWorkHours } from "./overflow";
import { endOfPeriod, periodRange } from "./horizon";
import { minutesToUtc, utcToMinutes } from "../common/utils";
import { TIME_GRANULARITY } from "../common/constants";

type PrismaTx = Prisma.TransactionClient;

export interface DisplacedTask {
  taskId: string;
  newScheduledStartTime: Date | null;
}

@Injectable()
export class SchedulerService {
  constructor(private readonly prisma: PrismaService) {}

  private prefsOf(user: User): SchedulerPrefs {
    return {
      workStart: user.workStart,
      workEnd: user.workEnd,
      workDays: user.workDays,
      timezone: user.timezone,
    };
  }

  /**
   * Map a Prisma row to the pure-core {@link EdfTask}. The period CEILING
   * (`schedulingDeadline`) is derived here — the I/O/tz layer — and applies only
   * to a FLEXIBLE task that has NO user `deadline` and DOES carry a stored
   * `view` + `schedulingAnchor`: such a task is bounded to the working hours of
   * the day/week/month it was created in (end of that period, in `timezone`) and
   * must not silently roll past it. Tasks with a user deadline, fixed tasks, or
   * legacy rows without a view get `schedulingDeadline = null` (unbounded —
   * byte-for-byte the previous behavior). `timezone` comes from the user's prefs.
   */
  private toEdf(task: Task, timezone: string): EdfTask {
    const schedulingDeadline =
      !task.fixed &&
      task.deadline === null &&
      task.view !== null &&
      task.schedulingAnchor !== null
        ? endOfPeriod(task.schedulingAnchor, task.view, timezone)
        : null;
    return {
      id: task.id,
      durationMinutes: task.durationMinutes,
      deadline: task.deadline,
      fixed: task.fixed,
      manuallyMoved: task.manuallyMoved,
      schedulingAnchor: task.schedulingAnchor,
      schedulingDeadline,
      scheduledStartTime: task.scheduledStartTime,
      createdAt: task.createdAt,
      conflict: task.conflict,
    };
  }

  private pendingTasks(userId: string, tx: PrismaTx) {
    return tx.task.findMany({ where: { userId, status: "PENDING" } });
  }

  /**
   * Deadline-aware (re-)placement after a flexible task is created or has its
   * deadline changed. Runs the full EDF re-pack around the anchors (fixed,
   * manually-moved, and frozen past tasks) so the affected task lands at its
   * EDF rank: tasks with closer deadlines keep their earlier slots and only
   * later ones cascade. Mutates the rows; runs inside the caller's transaction.
   *
   * Ordering is by deadline (then createdAt). Each flexible task carries its own
   * floor inside {@link scheduleAll}: a deadline-bearing task is packed from
   * `now` by pure urgency (its create-day is ignored), while a no-deadline task
   * is floored at its stored `schedulingAnchor` so it lands on/after the day it
   * was created from. Fixed tasks keep their own day/time, and manually-moved
   * tasks keep their dragged slot.
   *
   * A task that finds no slot before its deadline is left unplaced
   * (`scheduledStartTime: null`) and flagged as a conflict.
   */
  async cascadeReschedule(
    user: User,
    tx: PrismaTx,
    now = new Date(),
  ): Promise<void> {
    const tasks = await this.pendingTasks(user.id, tx);
    const placements = scheduleAll(
      this.prefsOf(user),
      tasks.map((t) => this.toEdf(t, user.timezone)),
      now,
    );
    const before = new Map(tasks.map((t) => [t.id, t]));
    for (const p of placements) {
      const prev = before.get(p.id);
      if (!prev) continue;
      const unchanged =
        (prev.scheduledStartTime?.getTime() ?? null) ===
          (p.scheduledStartTime?.getTime() ?? null) &&
        prev.conflict === p.conflict;
      if (unchanged) continue;
      await tx.task.update({
        where: { id: p.id },
        data: {
          scheduledStartTime: p.scheduledStartTime,
          conflict: p.conflict,
        },
      });
    }
  }

  /** Full deterministic re-EDF of every PENDING task (e.g. after pref change). */
  async rescheduleAll(user: User, now = new Date()): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.cascadeReschedule(user, tx, now);
    });
  }

  /**
   * Occupied intervals the overflow recovery slots must avoid: every OTHER
   * PENDING task that is placed and still occupies future time (mirrors how the
   * EDF packer builds its `occupied` set). Fully-elapsed past tasks occupy no
   * future time and are excluded; the `excludeId` task itself is excluded so it
   * doesn't block its own re-placement.
   */
  private occupiedIntervals(
    tasks: Task[],
    excludeId: string,
    now: Date,
  ): Interval[] {
    return tasks
      .filter((t) => t.id !== excludeId)
      .filter((t) => !isPast(t, now) || !hasElapsed(t, now))
      .map((t) => intervalOf(t))
      .filter((i): i is Interval => i !== null);
  }

  /**
   * The anchor a task's overflow recovery options are computed relative to: its
   * stored `schedulingAnchor` (start-of-day of the create day) when present, or
   * — for a legacy/fixed row without one — the start-of-day of `now` in the
   * user's tz. Both options are period-relative to this instant, NOT to `now`.
   */
  private overflowAnchor(task: Task, timezone: string, now: Date): Date {
    if (task.schedulingAnchor) return task.schedulingAnchor;
    return minutesToUtc(localDateStr(now, timezone), 0, timezone);
  }

  /**
   * Compute the two recovery options offered when the EDF engine couldn't place
   * `task` (it came back unplaced) — now relative to the task's ANCHOR period
   * (the viewed day/week/month it was created in), not to `now`:
   *  - `outsideHours`: earliest off-(working)-hours slot INSIDE the anchor
   *    period window `[periodStart, periodEnd)`, at/after `now`, respecting
   *    occupied and any user deadline. Null when no off-hours slot fits the
   *    period (e.g. the period has ended).
   *  - `nextAvailable`: earliest in-working-hours slot in the NEXT period after
   *    the anchor period (next day/week/month), ignoring the deadline.
   *
   * Loads the user's prefs + the other PENDING tasks' occupied intervals and
   * delegates to the pure helpers. Pure-core stays `now`+explicit-inputs driven;
   * this wrapper only does the I/O (period bounds from `task.schedulingAnchor`).
   */
  async computeOverflowOptions(
    user: User,
    task: Task,
    view: OverflowGranularity,
    tx: PrismaTx,
    now = new Date(),
  ): Promise<SchedulingOverflow> {
    const prefs = this.prefsOf(user);
    const tasks = await this.pendingTasks(user.id, tx);
    const occupied = this.occupiedIntervals(tasks, task.id, now);

    const anchor = this.overflowAnchor(task, prefs.timezone, now);
    const { start: periodStart, end: periodEnd } = periodRange(
      anchor,
      view,
      prefs.timezone,
    );

    const outside = findSlotIgnoringWorkHours(
      task.durationMinutes,
      task.deadline,
      occupied,
      now,
      periodStart,
      periodEnd,
    );
    const next = findNextAvailableSlot(
      prefs,
      task.durationMinutes,
      occupied,
      now,
      anchor,
      view,
    );

    return {
      outsideHours: outside
        ? { scheduledStartTime: outside.toISOString() }
        : null,
      nextAvailable: next
        ? { scheduledStartTime: next.toISOString(), granularity: view }
        : null,
    };
  }

  /**
   * Apply a chosen overflow recovery option to an unplaced task. The slot is
   * recomputed server-side (the client-supplied time is never trusted), the
   * task is pinned there as a `fixed` anchor (so the next {@link cascadeReschedule}
   * can't move it back into the unplaced state), conflicts are recomputed
   * pairwise, and a MOVE audit event is recorded. Runs in its own transaction
   * like the other mutations. The recompute is period-aware — it uses the task's
   * stored `schedulingAnchor` + `view` so the chosen slot lands in the SAME
   * window that was offered. Throws {@link BadRequestException} when the chosen
   * option is no longer feasible (recompute returns null).
   */
  async applyOverflowOption(
    user: User,
    taskId: string,
    choice: "outsideHours" | "nextAvailable",
    view: OverflowGranularity,
    now = new Date(),
  ): Promise<{ task: Task; displaced: DisplacedTask[] }> {
    return this.prisma.$transaction(async (tx) => {
      const tasks = await this.pendingTasks(user.id, tx);
      const target = tasks.find((t) => t.id === taskId);
      if (!target) throw new NotFoundException(`Cannot find task ${taskId}`);

      const prefs = this.prefsOf(user);
      const occupied = this.occupiedIntervals(tasks, taskId, now);
      const anchor = this.overflowAnchor(target, prefs.timezone, now);
      const { start: periodStart, end: periodEnd } = periodRange(
        anchor,
        view,
        prefs.timezone,
      );
      const slot =
        choice === "outsideHours"
          ? findSlotIgnoringWorkHours(
              target.durationMinutes,
              target.deadline,
              occupied,
              now,
              periodStart,
              periodEnd,
            )
          : findNextAvailableSlot(
              prefs,
              target.durationMinutes,
              occupied,
              now,
              anchor,
              view,
            );

      if (!slot) {
        throw new BadRequestException({
          success: false,
          message:
            choice === "outsideHours"
              ? "No off-hours slot is available before the deadline anymore"
              : "No slot is available in the next period anymore",
        });
      }

      // Pin as a fixed anchor at the recomputed slot. `fixed` + the matching
      // startTime (minutes-of-day in the user's tz) make the placement sticky:
      // scheduleAll treats it as an anchor and never re-EDFs it back to unplaced.
      const startTime = utcToMinutes(slot, user.timezone);
      const projected = tasks.map((t) =>
        t.id === taskId ? { ...t, scheduledStartTime: slot } : t,
      );
      const conflictOf = this.recomputeConflicts(projected);

      const before = new Map(tasks.map((t) => [t.id, t]));
      const displaced: DisplacedTask[] = [];
      let updatedTarget = target;

      for (const t of tasks) {
        const isTarget = t.id === taskId;
        const nextStart = isTarget ? slot : t.scheduledStartTime;
        const nextConflict = conflictOf.get(t.id) ?? t.conflict;
        const startUnchanged =
          (t.scheduledStartTime?.getTime() ?? null) ===
          (nextStart?.getTime() ?? null);
        if (startUnchanged && t.conflict === nextConflict && !isTarget)
          continue;

        const updated = await tx.task.update({
          where: { id: t.id },
          data: {
            scheduledStartTime: nextStart,
            conflict: nextConflict,
            ...(isTarget ? { fixed: true, startTime } : {}),
          },
        });
        if (isTarget) {
          updatedTarget = updated;
          await tx.taskEvent.create({
            data: {
              taskId: t.id,
              userId: user.id,
              eventType: "MOVE",
              oldSnapshot: this.snapshot(before.get(t.id)!),
              newSnapshot: this.snapshot(updated),
              rewardScore: 0.0, // user accepted a recovery option
            },
          });
        } else {
          displaced.push({
            taskId: t.id,
            newScheduledStartTime: updated.scheduledStartTime,
          });
        }
      }

      return { task: updatedTarget, displaced };
    });
  }

  /**
   * Manual drag-drop placement. Pins `taskId` at the snapped `requestedStart`
   * exactly where the user dropped it — no cascade, nothing else moves. Any
   * resulting time overlap is allowed and surfaced as a conflict; conflicts are
   * recomputed pairwise across all pending tasks so they self-heal when a task
   * is dragged back off another. The EDF engine only runs on create/pref edits.
   */
  async pin(
    user: User,
    taskId: string,
    requestedStart: Date,
  ): Promise<{ task: Task; displaced: DisplacedTask[] }> {
    return this.prisma.$transaction(async (tx) => {
      const tasks = await this.pendingTasks(user.id, tx);
      const target = tasks.find((t) => t.id === taskId);
      if (!target) throw new NotFoundException(`Cannot find task ${taskId}`);

      // Snap to the 15-minute grid the calendar drops onto.
      const snapped = new Date(
        Math.round(requestedStart.getTime() / SLOT_MS) * SLOT_MS,
      );

      // Project the move, then recompute every task's conflict from real
      // time-overlap (a placed task clashes if it overlaps another placed task).
      const projected = tasks.map((t) =>
        t.id === taskId ? { ...t, scheduledStartTime: snapped } : t,
      );
      const conflictOf = this.recomputeConflicts(projected);

      const before = new Map(tasks.map((t) => [t.id, t]));
      const displaced: DisplacedTask[] = [];
      let updatedTarget = target;

      for (const t of tasks) {
        const isTarget = t.id === taskId;
        const nextStart = isTarget ? snapped : t.scheduledStartTime;
        const nextConflict = conflictOf.get(t.id) ?? t.conflict;
        const startUnchanged =
          (t.scheduledStartTime?.getTime() ?? null) ===
          (nextStart?.getTime() ?? null);
        // The target is now anchored even if it didn't visibly move (snapped to
        // the same slot): the user's drop pins it against future EDF re-packs.
        const becomesAnchor = isTarget && !t.manuallyMoved;
        if (startUnchanged && t.conflict === nextConflict && !becomesAnchor)
          continue;

        const updated = await tx.task.update({
          where: { id: t.id },
          data: {
            scheduledStartTime: nextStart,
            conflict: nextConflict,
            ...(isTarget ? { manuallyMoved: true } : {}),
          },
        });
        if (t.id === taskId) {
          updatedTarget = updated;
          await tx.taskEvent.create({
            data: {
              taskId: t.id,
              userId: user.id,
              eventType: "MOVE",
              oldSnapshot: this.snapshot(before.get(t.id)!),
              newSnapshot: this.snapshot(updated),
              rewardScore: 0.0, // user override
            },
          });
        } else {
          displaced.push({
            taskId: t.id,
            newScheduledStartTime: updated.scheduledStartTime,
          });
        }
      }

      // Telemetry: the user overrode the engine's choice for this slot. Signed
      // preference update — the VACATED slot is disliked (-1, move-away) and the
      // DESTINATION slot is preferred (+1, move-toward). When the task wasn't
      // placed before (no vacated slot), only the move-toward signal applies.
      const deltas: { at: Date; delta: number }[] = [
        { at: snapped, delta: +1 },
      ];
      if (
        target.scheduledStartTime &&
        target.scheduledStartTime.getTime() !== snapped.getTime()
      ) {
        deltas.push({ at: target.scheduledStartTime, delta: -1 });
      }
      await this.applyPreference(user, deltas, tx);

      return { task: updatedTarget, displaced };
    });
  }

  /**
   * Manual edge-resize. Pins `taskId` at the snapped start with the new
   * duration exactly as the user dragged it — no cascade, nothing else moves.
   * Conflicts are recomputed pairwise from real time-overlap across all pending
   * tasks (the new size may create or clear an overlap), mirroring {@link pin}.
   * Records a RESIZE audit event for the target.
   */
  async resize(
    user: User,
    taskId: string,
    requestedStart: Date,
    durationMinutes: number,
  ): Promise<{ task: Task; displaced: DisplacedTask[] }> {
    return this.prisma.$transaction(async (tx) => {
      const tasks = await this.pendingTasks(user.id, tx);
      const target = tasks.find((t) => t.id === taskId);
      if (!target) throw new NotFoundException(`Cannot find task ${taskId}`);

      // Snap start and duration to the 15-minute grid the calendar drops onto.
      const snappedStart = new Date(
        Math.round(requestedStart.getTime() / SLOT_MS) * SLOT_MS,
      );
      const snappedDuration = Math.max(
        TIME_GRANULARITY,
        Math.round(durationMinutes / TIME_GRANULARITY) * TIME_GRANULARITY,
      );

      // Project the resize, then recompute every task's conflict from real
      // time-overlap (a placed task clashes if it overlaps another placed task).
      const projected = tasks.map((t) =>
        t.id === taskId
          ? {
              ...t,
              scheduledStartTime: snappedStart,
              durationMinutes: snappedDuration,
            }
          : t,
      );
      const conflictOf = this.recomputeConflicts(projected);

      const before = new Map(tasks.map((t) => [t.id, t]));
      const displaced: DisplacedTask[] = [];
      let updatedTarget = target;

      for (const t of tasks) {
        const nextConflict = conflictOf.get(t.id) ?? t.conflict;
        if (t.id === taskId) {
          const updated = await tx.task.update({
            where: { id: t.id },
            data: {
              scheduledStartTime: snappedStart,
              durationMinutes: snappedDuration,
              conflict: nextConflict,
              manuallyMoved: true,
            },
          });
          updatedTarget = updated;
          await tx.taskEvent.create({
            data: {
              taskId: t.id,
              userId: user.id,
              eventType: "RESIZE",
              oldSnapshot: this.snapshot(before.get(t.id)!),
              newSnapshot: this.snapshot(updated),
              rewardScore: 0.0, // user override
            },
          });
        } else {
          // Only conflict can change for the others — the resize never moves them.
          if (t.conflict === nextConflict) continue;
          const updated = await tx.task.update({
            where: { id: t.id },
            data: { conflict: nextConflict },
          });
          displaced.push({
            taskId: t.id,
            newScheduledStartTime: updated.scheduledStartTime,
          });
        }
      }

      return { task: updatedTarget, displaced };
    });
  }

  /**
   * Recompute each task's conflict flag from pure time-overlap across the
   * `projected` set: a placed task clashes if it overlaps any other placed task,
   * anywhere in the window. Conflict detection is now-INDEPENDENT — elapsed,
   * in-progress, and past tasks all participate, so a manual pin/drag onto an
   * already-elapsed block surfaces a conflict and a past overlap self-heals once
   * the overlap is gone. Drives the manual {@link pin}/{@link resize} drops.
   * Placement is unaffected here (those methods only write the target's slot);
   * unplaced tasks keep the engine's verdict.
   */
  private recomputeConflicts(
    projected: {
      id: string;
      scheduledStartTime: Date | null;
      durationMinutes: number;
      conflict: boolean;
    }[],
  ): Map<string, boolean> {
    const overlaps = (a: Interval, b: Interval) =>
      a.start < b.end && b.start < a.end;
    const conflictOf = new Map<string, boolean>();
    for (const t of projected) {
      const iv = intervalOf(t);
      if (!iv) {
        conflictOf.set(t.id, t.conflict); // unplaced — keep engine's verdict
        continue;
      }
      conflictOf.set(
        t.id,
        projected.some((o) => {
          if (o.id === t.id) return false;
          const oiv = intervalOf(o);
          return oiv ? overlaps(iv, oiv) : false;
        }),
      );
    }
    return conflictOf;
  }

  private snapshot(task: Task): Prisma.InputJsonValue {
    return {
      scheduledStartTime: task.scheduledStartTime
        ? task.scheduledStartTime.toISOString()
        : null,
      durationMinutes: task.durationMinutes,
    };
  }

  /**
   * Apply signed deltas to the user's 7×96 preference matrix in one update.
   * Each entry is `{ at, delta }`: a positive delta marks a liked/kept block
   * (move-toward / accepted), a negative delta a disliked block (move-away).
   * The matrix is seeded lazily to all-zero when it isn't the expected length,
   * and out-of-range indices are skipped. Transactional with the caller.
   */
  private async applyPreference(
    user: User,
    deltas: { at: Date; delta: number }[],
    tx: PrismaTx,
  ) {
    if (deltas.length === 0) return;
    const matrix =
      user.preferenceMatrix.length === PREFERENCE_MATRIX_LENGTH
        ? [...user.preferenceMatrix]
        : new Array<number>(PREFERENCE_MATRIX_LENGTH).fill(0);
    for (const { at, delta } of deltas) {
      const idx = preferenceIndex(at, user.timezone);
      if (idx >= 0 && idx < PREFERENCE_MATRIX_LENGTH) matrix[idx] += delta;
    }
    await tx.user.update({
      where: { id: user.id },
      data: { preferenceMatrix: matrix },
    });
  }
}
