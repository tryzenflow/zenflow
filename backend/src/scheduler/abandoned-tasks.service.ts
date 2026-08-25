import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service";
import { Prisma, TaskEventType, TaskStatus } from "../../generated/prisma";
import { ABANDON_BATCH_SIZE, ABANDON_GRACE_MS } from "../common/constants";

// The rest of `telemetry.ts` (Phase-3 reward telemetry) was removed pending
// the scheduler rebuild — this is the one constant the abandon sweep still
// needs, so it's kept local rather than reviving the whole module.
const ABANDON_REWARD = -1.0;

type AbandonCandidate = Prisma.TaskGetPayload<{
  select: {
    id: true;
    userId: true;
    scheduledStartTime: true;
    durationMinutes: true;
    tags: { select: { name: true } };
  };
}>;

@Injectable()
export class AbandonedTasksService {
  private readonly logger = new Logger(AbandonedTasksService.name);

  constructor(private readonly prisma: PrismaService) {}

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

  async sweep(now = new Date(), userId?: string): Promise<number> {
    const cutoff = new Date(now.getTime() - ABANDON_GRACE_MS);
    let total = 0;

    const where: Prisma.TaskWhereInput = {
      status: TaskStatus.PENDING,
      deadline: { lt: cutoff },
      ...(userId ? { userId } : {}),
    };

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
            data: { status: TaskStatus.ABANDONED },
          });
          await tx.taskEvent.create({
            data: {
              taskId: task.id,
              userId: task.userId,
              eventType: TaskEventType.ABANDON,
              // The slot it died in — mirrors how COMPLETE captures its slot.
              oldSnapshot: Prisma.JsonNull,
              newSnapshot: this.snapshot(task),
              // Strongest negative outcome signal (COMPLETE = +1.0, MOVE = 0.0).
              rewardScore: ABANDON_REWARD,
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
