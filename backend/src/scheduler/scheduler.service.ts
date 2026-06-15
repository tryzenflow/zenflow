import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { Prisma, type Task, type User } from "../../generated/prisma";
import {
  PENALTY_MATRIX_LENGTH,
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
import { type Interval, SLOT_MS, penaltyIndex } from "./slot";
import { findNextAvailableSlot, findSlotIgnoringWorkHours } from "./overflow";
import { utcToMinutes } from "../common/utils";
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

  private toEdf(task: Task): EdfTask {
    return {
      id: task.id,
      durationMinutes: task.durationMinutes,
      deadline: task.deadline,
      fixed: task.fixed,
      manuallyMoved: task.manuallyMoved,
      schedulingAnchor: task.schedulingAnchor,
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
      tasks.map((t) => this.toEdf(t)),
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
      .map((t) => this.toEdf(t))
      .map(intervalOf)
      .filter((i): i is Interval => i !== null);
  }

  /**
   * Compute the two recovery options offered when the EDF engine couldn't place
   * `task` within working hours before its deadline (the created task came back
   * unplaced). Loads the user's prefs + the other PENDING tasks' occupied
   * intervals and delegates to the pure {@link findSlotIgnoringWorkHours} /
   * {@link findNextAvailableSlot} helpers. Pure-core stays `now`-driven; this
   * wrapper only does the I/O.
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

    const outside = findSlotIgnoringWorkHours(
      task.durationMinutes,
      task.deadline,
      occupied,
      now,
    );
    const next = findNextAvailableSlot(
      prefs,
      task.durationMinutes,
      occupied,
      now,
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
   * like the other mutations. Throws {@link BadRequestException} when the chosen
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

      const occupied = this.occupiedIntervals(tasks, taskId, now);
      const slot =
        choice === "outsideHours"
          ? findSlotIgnoringWorkHours(
              target.durationMinutes,
              target.deadline,
              occupied,
              now,
            )
          : findNextAvailableSlot(
              this.prefsOf(user),
              target.durationMinutes,
              occupied,
              now,
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

      // Telemetry: the user overrode the engine's choice for this slot.
      if (target.scheduledStartTime) {
        await this.bumpPenalty(user, target.scheduledStartTime, tx);
      }

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

  private async bumpPenalty(user: User, vacated: Date, tx: PrismaTx) {
    const matrix =
      user.penaltyMatrix.length === PENALTY_MATRIX_LENGTH
        ? [...user.penaltyMatrix]
        : new Array<number>(PENALTY_MATRIX_LENGTH).fill(0);
    const idx = penaltyIndex(vacated, user.timezone);
    if (idx >= 0 && idx < PENALTY_MATRIX_LENGTH) matrix[idx] += 1;
    await tx.user.update({
      where: { id: user.id },
      data: { penaltyMatrix: matrix },
    });
  }
}
