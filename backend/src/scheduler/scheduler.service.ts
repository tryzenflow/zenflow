import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { Prisma, type Task, type User } from "../../generated/prisma";
import { PENALTY_MATRIX_LENGTH } from "@zenflow/shared";
import {
  cascadeReschedule,
  type EdfTask,
  placeOne,
  scheduleAll,
  type SchedulerPrefs,
} from "./edf";
import { penaltyIndex } from "./slot";

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
    };
  }

  private pendingTasks(userId: string, tx: PrismaTx) {
    return tx.task.findMany({ where: { userId, status: "PENDING" } });
  }

  /**
   * Place a single freshly-created task around already-scheduled tasks
   * (preserves existing placements). Mutates the row; run inside a transaction.
   */
  async placeNewTask(
    user: User,
    task: Task,
    tx: PrismaTx,
    now = new Date(),
  ): Promise<{ scheduledStartTime: Date | null; conflict: boolean }> {
    const others = (await this.pendingTasks(user.id, tx)).filter(
      (t) => t.id !== task.id,
    );
    const placement = placeOne(
      this.prefsOf(user),
      this.toEdf(task),
      others.map((t) => this.toEdf(t)),
      now,
    );
    await tx.task.update({
      where: { id: task.id },
      data: {
        scheduledStartTime: placement.scheduledStartTime,
        conflict: placement.conflict,
      },
    });
    return placement;
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
   * Manual move with cascading realignment. Persists every moved task, records
   * MOVE audit events, and increments the penalty matrix for the vacated slot.
   */
  async reschedule(
    user: User,
    taskId: string,
    requestedStart: Date,
    now = new Date(),
  ): Promise<{ task: Task; displaced: DisplacedTask[] }> {
    return this.prisma.$transaction(async (tx) => {
      const tasks = await this.pendingTasks(user.id, tx);
      const before = new Map(tasks.map((t) => [t.id, t]));
      const target = before.get(taskId);
      if (!target) throw new NotFoundException(`Cannot find task ${taskId}`);

      const placements = cascadeReschedule(
        this.prefsOf(user),
        tasks.map((t) => this.toEdf(t)),
        taskId,
        requestedStart,
        now,
      );

      let updatedTarget: Task = target;
      const displaced: DisplacedTask[] = [];

      for (const p of placements) {
        const prev = before.get(p.id);
        if (!prev) continue;
        const updated = await tx.task.update({
          where: { id: p.id },
          data: {
            scheduledStartTime: p.scheduledStartTime,
            conflict: p.conflict,
          },
        });
        await tx.taskEvent.create({
          data: {
            taskId: p.id,
            userId: user.id,
            eventType: "MOVE",
            oldSnapshot: this.snapshot(prev),
            newSnapshot: this.snapshot(updated),
            rewardScore: 0.0, // user override
          },
        });
        if (p.id === taskId) updatedTarget = updated;
        else
          displaced.push({
            taskId: p.id,
            newScheduledStartTime: p.scheduledStartTime,
          });
      }

      // Telemetry: increment penalty matrix for the target's vacated slot.
      if (target.scheduledStartTime) {
        await this.bumpPenalty(user, target.scheduledStartTime, tx);
      }

      return { task: updatedTarget, displaced };
    });
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
