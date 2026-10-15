import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { KillSwitchService } from "../common/killswitch/killswitch.service";
import { QueueService } from "../queue/queue.service";
import { NOTIFY_QUEUE } from "../queue/queues";
import { idempotencyKey } from "../queue/queue.types";
import { PrismaService } from "../prisma/prisma.service";
import { duePushes } from "./core/time";

const PAGE = 500;

/**
 * Watcher-only (ADR-0011): every minute, queues the morning brief and evening
 * check-in that are due for each opted-in user. One repeatable sweep covers
 * every user, so there is no per-user cron.
 *
 * The job id is `daily_<kind>_<userId>_<localDate>_<provider>`, so a push is
 * queued at most once per user per local day, however often the sweep runs.
 * Each user is read once per minute; scanning is paged by id.
 */
@Injectable()
export class DailyPushSweepService {
  private readonly logger = new Logger(DailyPushSweepService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly killSwitch: KillSwitchService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async sweep(now: Date = new Date()): Promise<number> {
    if (!(await this.killSwitch.isEnabled("notifications"))) return 0;
    let queued = 0;
    let cursor: string | undefined;
    try {
      for (;;) {
        const users = await this.prisma.user.findMany({
          where: {
            OR: [
              { morningBriefTime: { not: null } },
              { eveningCheckinTime: { not: null } },
            ],
          },
          select: {
            id: true,
            timezone: true,
            morningBriefTime: true,
            eveningCheckinTime: true,
          },
          orderBy: { id: "asc" },
          take: PAGE,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });
        for (const user of users) {
          const due = duePushes(now, user.timezone, {
            morningBriefTime: user.morningBriefTime,
            eveningCheckinTime: user.eveningCheckinTime,
          });
          for (const push of due) {
            for (const provider of ["fcm", "apns"] as const) {
              const job = await this.queue.enqueueBestEffort(
                NOTIFY_QUEUE,
                {
                  type: "daily",
                  userId: user.id,
                  kind: push.kind,
                  localDate: push.localDate,
                  provider,
                },
                {
                  jobId: idempotencyKey(
                    "daily",
                    push.kind,
                    user.id,
                    push.localDate,
                    provider,
                  ),
                },
              );
              if (job) queued++;
            }
          }
        }
        if (users.length < PAGE) break;
        cursor = users[users.length - 1].id;
      }
    } catch (err) {
      this.logger.warn(`daily push sweep failed: ${(err as Error).message}`);
    }
    if (queued > 0) this.logger.log(`queued ${queued} daily push job(s)`);
    return queued;
  }
}
