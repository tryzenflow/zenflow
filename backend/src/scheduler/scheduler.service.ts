import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { Prisma, type Task, type User } from "../../generated/prisma";
import { PENALTY_MATRIX_LENGTH } from "@zenflow/shared";
import {
  type EdfTask,
  intervalOf,
  isPast,
  placeOne,
  scheduleAll,
  type SchedulerPrefs,
} from "./edf";
import { type Interval, SLOT_MS, penaltyIndex } from "./slot";
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
      scheduledStartTime: task.scheduledStartTime,
      createdAt: task.createdAt,
      conflict: task.conflict,
    };
  }

  private pendingTasks(userId: string, tx: PrismaTx) {
    return tx.task.findMany({ where: { userId, status: "PENDING" } });
  }

  /**
   * Place a single freshly-created task around already-scheduled tasks
   * (preserves existing placements). Mutates the row; run inside a transaction.
   *
   *  - `earliest` anchors a flexible task to a chosen day (the view it was
   *    created from) instead of the first open slot from `now`.
   *
   * A task that finds no slot before its deadline is left unplaced
   * (`scheduledStartTime: null`) and flagged as a conflict.
   */
  async placeNewTask(
    user: User,
    task: Task,
    tx: PrismaTx,
    opts: { earliest?: Date } = {},
    now = new Date(),
  ): Promise<{ scheduledStartTime: Date | null; conflict: boolean }> {
    const others = (await this.pendingTasks(user.id, tx)).filter(
      (t) => t.id !== task.id,
    );
    const { scheduledStartTime, conflict } = placeOne(
      this.prefsOf(user),
      this.toEdf(task),
      others.map((t) => this.toEdf(t)),
      now,
      opts.earliest,
    );
    await tx.task.update({
      where: { id: task.id },
      data: { scheduledStartTime, conflict },
    });
    return { scheduledStartTime, conflict };
  }

  /** Full deterministic re-EDF of every PENDING task (e.g. after pref change). */
  async rescheduleAll(user: User, now = new Date()): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
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
    now = new Date(),
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
      const conflictOf = this.recomputeConflicts(projected, now);

      const before = new Map(tasks.map((t) => [t.id, t]));
      const displaced: DisplacedTask[] = [];
      let updatedTarget = target;

      for (const t of tasks) {
        const nextStart = t.id === taskId ? snapped : t.scheduledStartTime;
        const nextConflict = conflictOf.get(t.id) ?? t.conflict;
        const startUnchanged =
          (t.scheduledStartTime?.getTime() ?? null) ===
          (nextStart?.getTime() ?? null);
        if (startUnchanged && t.conflict === nextConflict) continue;

        const updated = await tx.task.update({
          where: { id: t.id },
          data: { scheduledStartTime: nextStart, conflict: nextConflict },
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
    now = new Date(),
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
      const conflictOf = this.recomputeConflicts(projected, now);

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
   * Recompute each task's conflict flag from real time-overlap across the
   * `projected` set: a placed task clashes if it overlaps another placed task.
   * Drives the manual {@link pin}/{@link resize} drops (the only places where a
   * placed-but-overlapping conflict can arise). Frozen past tasks keep their
   * stored verdict and never cause a live task to conflict; unplaced tasks keep
   * the engine's verdict.
   */
  private recomputeConflicts(
    projected: {
      id: string;
      scheduledStartTime: Date | null;
      durationMinutes: number;
      conflict: boolean;
    }[],
    now: Date,
  ): Map<string, boolean> {
    const overlaps = (a: Interval, b: Interval) =>
      a.start < b.end && b.start < a.end;
    const conflictOf = new Map<string, boolean>();
    for (const t of projected) {
      // Past tasks are frozen: their conflict is never recomputed.
      if (isPast(t, now)) {
        conflictOf.set(t.id, t.conflict);
        continue;
      }
      const iv = intervalOf(t);
      if (!iv) {
        conflictOf.set(t.id, t.conflict); // unplaced — keep engine's verdict
        continue;
      }
      conflictOf.set(
        t.id,
        projected.some((o) => {
          if (o.id === t.id) return false;
          // A frozen past block never causes a live task to conflict.
          if (isPast(o, now)) return false;
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
