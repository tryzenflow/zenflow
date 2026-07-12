import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service";
import { Prisma } from "../../generated/prisma";
import { ABANDON_BATCH_SIZE, ABANDON_GRACE_MS } from "../common/constants";
import { EVENT_REWARD } from "./utils/telemetry";

/**
 * The minimal task fields the sweep needs: the id/userId to write the row +
 * event, the slot fields the {@link snapshot} helper records as the slot the
 * task died in (mirrors how COMPLETE captures `scheduledStartTime`/duration),
 * and the related Tag rows so the snapshot records the task's tag names at event
 * time (Phase-2 telemetry — "tags then", not "tags now").
 */
type AbandonCandidate = Prisma.TaskGetPayload<{
  select: {
    id: true;
    userId: true;
    scheduledStartTime: true;
    durationMinutes: true;
    tags: { select: { name: true } };
  };
}>;

/**
 * Sweeps deadline-bearing tasks whose deadline has expired into the ABANDONED
 * outcome state.
 *
 * A task is abandoned when it is still `PENDING`, carries a user `deadline`, and
 * that deadline passed by more than {@link ABANDON_GRACE_MS} — the deadline
 * window closed without completion. Deadline-LESS tasks (flexible floaters) are
 * never abandoned: they roll forward forever and are excluded by the query.
 * A merely-passed scheduled SLOT is not abandonment — flexible tasks get
 * re-packed by EDF — so the sweep keys strictly on `deadline`, never on
 * `scheduledStartTime`. Comparisons are UTC-instant vs UTC-instant, so `now` is
 * a plain wall-clock-free `new Date()`.
 *
 * This is the I/O + telemetry side of abandonment, deliberately kept out of the
 * pure scheduler core (`edf.ts`/`slot.ts`/`horizon.ts`).
 *
 * Idempotency: candidates are selected by `status: PENDING` and each is flipped
 * to ABANDONED in the same transaction, so a task is swept exactly once and
 * emits exactly one ABANDON event — a later run cannot re-select it.
 */
@Injectable()
export class AbandonedTasksService {
  private readonly logger = new Logger(AbandonedTasksService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * The slot a task occupied at abandonment, recorded as the ABANDON event's
   * snapshot — the same shape the rest of the telemetry uses
   * ({@link SchedulerService.snapshot}). Kept local so this provider doesn't
   * reach into the EDF service.
   */
  private snapshot(task: AbandonCandidate): Prisma.InputJsonValue {
    return {
      scheduledStartTime: task.scheduledStartTime
        ? task.scheduledStartTime.toISOString()
        : null,
      durationMinutes: task.durationMinutes,
      // Tag NAMES at abandonment (sorted) — "tags then" for Phase-2 telemetry.
      tags: task.tags.map((t) => t.name).sort((a, b) => a.localeCompare(b)),
    };
  }

  /**
   * Hourly sweep. Abandonment is not minute-sensitive, so EVERY_HOUR is the
   * right cadence. Delegates to {@link sweep}; `now` is injectable for tests.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async handleCron(): Promise<void> {
    const count = await this.sweep();
    if (count > 0) {
      this.logger.log(`Swept ${count} overdue task(s) into ABANDONED`);
    }
  }

  /**
   * Flip every overdue, deadline-bearing PENDING task to ABANDONED and emit one
   * ABANDON TaskEvent each. Processed in {@link ABANDON_BATCH_SIZE} chunks, each
   * in its own transaction, so a large overdue backlog never opens one giant
   * unbounded transaction. Returns the number of tasks abandoned.
   */
  async sweep(now = new Date(), userId?: string): Promise<number> {
    const cutoff = new Date(now.getTime() - ABANDON_GRACE_MS);
    let total = 0;

    // Optional `userId` scope: the cron sweeps everyone, but the simulator runs
    // personas concurrently and scopes each sweep to its own (disjoint) user so
    // two parallel sweeps can never select — and double-abandon — the same row.
    const where: Prisma.TaskWhereInput = {
      status: "PENDING",
      deadline: { lt: cutoff },
      ...(userId ? { userId } : {}),
    };

    // Re-query each round: the previous batch's update flips those rows away
    // from PENDING, so they can never be re-selected (idempotency).
    for (;;) {
      const candidates = await this.prisma.task.findMany({
        where,
        select: {
          id: true,
          userId: true,
          scheduledStartTime: true,
          durationMinutes: true,
          tags: { select: { name: true } },
        },
        take: ABANDON_BATCH_SIZE,
      });
      if (candidates.length === 0) break;

      await this.prisma.$transaction(async (tx) => {
        for (const task of candidates) {
          await tx.task.update({
            where: { id: task.id },
            data: { status: "ABANDONED" },
          });
          await tx.taskEvent.create({
            data: {
              taskId: task.id,
              userId: task.userId,
              eventType: "ABANDON",
              // The slot it died in — mirrors how COMPLETE captures its slot.
              oldSnapshot: Prisma.JsonNull,
              newSnapshot: this.snapshot(task),
              // Strongest negative outcome signal (COMPLETE = +1.0, MOVE = 0.0).
              rewardScore: EVENT_REWARD.ABANDON,
            },
          });
        }
      });

      total += candidates.length;
      // A full batch may mean more remain; a short batch means we drained it.
      if (candidates.length < ABANDON_BATCH_SIZE) break;
    }

    return total;
  }
}
