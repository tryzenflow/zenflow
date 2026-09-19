import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import {
  Prisma,
  SessionEventType,
  SessionSource,
  SessionType,
} from "../../../generated/prisma";
import { PrismaService } from "../../prisma/prisma.service";
import { RETAINED_BATCH_SIZE, RETAINED_GRACE_MS } from "../../common/constants";
import {
  PREFERENCE_RETAINED_WEIGHT,
  SESSION_RETAINED_REWARD,
} from "../constants";
import { SchedulingFeedbackService } from "./scheduling-feedback.service";
import { runCronJob } from "../../observability/cron";

type RetainedCandidate = Prisma.SessionGetPayload<{
  select: {
    id: true;
    userId: true;
    type: true;
    scheduledStartTime: true;
    durationMinutes: true;
    tags: { select: { name: true } };
    user: { select: { timezone: true } };
  };
}>;

type RewardedSession = {
  sessionId: string;
  userId: string;
  eventId: bigint;
  scheduledStartMs: number;
  timezone: string;
};

/**
 * Half-hourly sweep that turns "a scheduled TASK elapsed and the user never
 * moved it" into a positive `RETAINED` reward signal — the "keep" half of the
 * move-or-keep model that replaced task completion/abandonment.
 *
 * The ONLY layer here that touches Prisma. A row qualifies when it is a
 * user-created `TASK`, has a `scheduledStartTime`, its end plus
 * {@link RETAINED_GRACE_MS} is in the past, and it has never been moved
 * (`lastMovedAt == null`). `retainedAt` is stamped once so a re-run is a no-op.
 *
 * When the elapsed session was placed by a LinUCB `SlotProposal`, the sweep
 * also delivers the delayed `+1` reward to that arm via
 * {@link SchedulingFeedbackService.applyDelayedReward} — the same shared path
 * the first-`MOVE` signal uses (ADR-0001 §9). Independently of that gate, the
 * sweep ALSO reinforces the user's shared preference matrix (Item 3B3) via
 * {@link SchedulingFeedbackService.reinforcePreferenceMatrix} — weighted
 * `PREFERENCE_RETAINED_WEIGHT` on the hour bucket containing the session's
 * kept start — regardless of whether the
 * placement was heuristic or LinUCB.
 */
@Injectable()
export class RetainedSessionsService {
  private readonly logger = new Logger(RetainedSessionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly schedulingFeedback: SchedulingFeedbackService,
  ) {}

  /** Every 30 minutes. `now` is injectable for tests. */
  @Cron(CronExpression.EVERY_30_MINUTES)
  async handleCron(): Promise<void> {
    await runCronJob("retained-sessions", async () => {
      const count = await this.sweep();
      if (count > 0) {
        this.logger.log(`Marked ${count} session(s) RETAINED`);
      }
    });
  }

  async sweep(now = new Date(), userId?: string): Promise<number> {
    let total = 0;
    let cursor: string | undefined;

    for (;;) {
      const candidates = await this.findCandidateBatch(now, userId, cursor);
      if (candidates.length === 0) break;
      cursor = candidates[candidates.length - 1].id;

      const elapsed = this.filterElapsed(candidates, now);
      if (elapsed.length > 0) {
        const rewarded = await this.markRetainedBatch(elapsed, now);
        total += elapsed.length;
        await this.applyDelayedRewards(rewarded);
      }

      if (candidates.length < RETAINED_BATCH_SIZE) break;
    }

    return total;
  }

  private findCandidateBatch(
    now: Date,
    userId: string | undefined,
    cursor: string | undefined,
  ): Promise<RetainedCandidate[]> {
    return this.prisma.session.findMany({
      where: {
        type: SessionType.TASK,
        source: SessionSource.USER,
        retainedAt: null,
        lastMovedAt: null,
        scheduledStartTime: { not: null, lte: now },
        ...(userId ? { userId } : {}),
      },
      select: {
        id: true,
        userId: true,
        type: true,
        scheduledStartTime: true,
        durationMinutes: true,
        tags: { select: { name: true } },
        user: { select: { timezone: true } },
      },
      orderBy: { id: "asc" },
      take: RETAINED_BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
  }

  /** Rows whose interval (plus grace) has fully elapsed. Rows that haven't
   * yet are left untouched and stepped over by the cursor. */
  private filterElapsed(
    candidates: RetainedCandidate[],
    now: Date,
  ): RetainedCandidate[] {
    return candidates.filter((s) => {
      const end = s.scheduledStartTime!.getTime() + s.durationMinutes * 60_000;
      return end + RETAINED_GRACE_MS <= now.getTime();
    });
  }

  private async markRetainedBatch(
    elapsed: RetainedCandidate[],
    now: Date,
  ): Promise<RewardedSession[]> {
    const rewarded: RewardedSession[] = [];
    await this.prisma.$transaction(async (tx) => {
      for (const session of elapsed) {
        await tx.session.update({
          where: { id: session.id },
          data: { retainedAt: now },
        });
        const event = await tx.sessionEvent.create({
          data: {
            sessionId: session.id,
            userId: session.userId,
            eventType: SessionEventType.RETAINED,
            oldSnapshot: Prisma.JsonNull,
            newSnapshot: this.snapshot(session),
            rewardScore: SESSION_RETAINED_REWARD,
          },
          select: { id: true },
        });
        rewarded.push({
          sessionId: session.id,
          userId: session.userId,
          eventId: event.id,
          scheduledStartMs: session.scheduledStartTime!.getTime(),
          timezone: session.user.timezone,
        });
      }
    });
    return rewarded;
  }

  /** Delayed LinUCB reward + preference-matrix reinforcement — best-effort,
   * outside the transaction. `null` modification type: a RETAINED session
   * confirms the placement, it isn't a modification, so the acceptance
   * columns are left untouched. The preference-matrix reinforcement
   * (Item 3B3) runs unconditionally, regardless of which policy placed the
   * session — unlike the LinUCB reward, which only applies when a matching
   * `SlotProposal` exists. */
  private async applyDelayedRewards(
    rewarded: RewardedSession[],
  ): Promise<void> {
    for (const r of rewarded) {
      await this.schedulingFeedback.applyDelayedReward(
        r.userId,
        r.sessionId,
        r.eventId,
        SESSION_RETAINED_REWARD,
        null,
      );
      await this.schedulingFeedback.reinforcePreferenceMatrix(
        r.userId,
        r.scheduledStartMs,
        r.timezone,
        PREFERENCE_RETAINED_WEIGHT,
      );
    }
  }

  private snapshot(session: RetainedCandidate): Prisma.InputJsonValue {
    return {
      scheduledStartTime: session.scheduledStartTime
        ? session.scheduledStartTime.toISOString()
        : null,
      durationMinutes: session.durationMinutes,
      type: session.type,
      tags: session.tags.map((t) => t.name).sort((a, b) => a.localeCompare(b)),
    };
  }
}
