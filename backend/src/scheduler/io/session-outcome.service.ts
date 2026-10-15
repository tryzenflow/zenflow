import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import {
  Prisma,
  SessionEventType,
  SessionSource,
  SessionType,
} from "../../../generated/prisma";
import { PrismaService } from "../../prisma/prisma.service";
import { OUTCOME_BATCH_SIZE } from "../../common/constants";
import {
  PREFERENCE_RETAINED_WEIGHT,
  SESSION_COMPLETED_REWARD,
  SESSION_MISSED_REWARD,
} from "../constants";
import { completionReward, type CompletionOutcome } from "../core/reward";
import { SchedulingFeedbackService } from "./scheduling-feedback.service";
import { runCronJob } from "../../observability/cron";
import { schedulerSessionEvents } from "../../observability/metrics";

type OutcomeCandidate = Prisma.SessionGetPayload<{
  select: {
    id: true;
    userId: true;
    type: true;
    scheduledStartTime: true;
    durationMinutes: true;
    completedAt: true;
    skipped: true;
    tags: { select: { name: true } };
    user: { select: { timezone: true } };
  };
}>;

type Settled = {
  sessionId: string;
  userId: string;
  eventId: bigint;
  outcome: CompletionOutcome;
  reward: number;
  scheduledStartMs: number;
  timezone: string;
};

/**
 * Half-hourly sweep that settles the outcome of an unmoved scheduled `TASK`
 * (ADR-0023). It is the only layer here that touches Prisma.
 *
 * A row qualifies when it is a user-created `TASK` with a `scheduledStartTime`,
 * has never been moved (`lastMovedAt == null`) and is not yet settled
 * (`retainedAt == null`; the column stamps the settlement). The pure
 * {@link completionReward} decides the outcome:
 *
 * - checked off inside the slot: `COMPLETED`, `+1`, settled at `end + grace`;
 * - skipped: `SKIPPED`, `-1`, settled at `end + grace`;
 * - no check-off by `end + cutoff`: `MISSED`, `-1`. A `MISSED` event is written.
 *
 * The settled reward is delivered to the LinUCB arm behind the placement via
 * {@link SchedulingFeedbackService.applyDelayedReward}. A completion also
 * reinforces the user's preference matrix at the kept hour.
 */
@Injectable()
export class SessionOutcomeService {
  private readonly logger = new Logger(SessionOutcomeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly schedulingFeedback: SchedulingFeedbackService,
  ) {}

  /** Every 30 minutes. `now` is injectable for tests. */
  @Cron(CronExpression.EVERY_30_MINUTES)
  async handleCron(): Promise<void> {
    await runCronJob("session-outcomes", async () => {
      const count = await this.sweep();
      if (count > 0) {
        this.logger.log(`Settled ${count} session outcome(s)`);
      }
    });
  }

  async sweep(now = new Date(), userId?: string): Promise<number> {
    let total = 0;
    let cursor: string | undefined;

    for (;;) {
      const candidates = await this.findCandidateBatch(userId, cursor);
      if (candidates.length === 0) break;
      cursor = candidates[candidates.length - 1].id;

      const outcomes = this.decideOutcomes(candidates, now);
      if (outcomes.length > 0) {
        const settled = await this.settleBatch(outcomes, now);
        total += settled.length;
        await this.applyDelayedRewards(settled);
      }

      if (candidates.length < OUTCOME_BATCH_SIZE) break;
    }

    return total;
  }

  private findCandidateBatch(
    userId: string | undefined,
    cursor: string | undefined,
  ): Promise<OutcomeCandidate[]> {
    return this.prisma.session.findMany({
      where: {
        type: SessionType.TASK,
        source: SessionSource.USER,
        retainedAt: null,
        lastMovedAt: null,
        deleted: false,
        scheduledStartTime: { not: null },
        ...(userId ? { userId } : {}),
      },
      select: {
        id: true,
        userId: true,
        type: true,
        scheduledStartTime: true,
        durationMinutes: true,
        completedAt: true,
        skipped: true,
        tags: { select: { name: true } },
        user: { select: { timezone: true } },
      },
      orderBy: { id: "asc" },
      take: OUTCOME_BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
  }

  /** Candidates whose outcome is settled at `now`; the rest are stepped over. */
  private decideOutcomes(
    candidates: OutcomeCandidate[],
    now: Date,
  ): { session: OutcomeCandidate; outcome: CompletionOutcome }[] {
    const out: { session: OutcomeCandidate; outcome: CompletionOutcome }[] = [];
    for (const session of candidates) {
      const start = session.scheduledStartTime!.getTime();
      const outcome = completionReward(
        start,
        start + session.durationMinutes * 60_000,
        session.completedAt ? session.completedAt.getTime() : null,
        session.skipped,
        now.getTime(),
      );
      if (outcome) out.push({ session, outcome });
    }
    return out;
  }

  private async settleBatch(
    outcomes: { session: OutcomeCandidate; outcome: CompletionOutcome }[],
    now: Date,
  ): Promise<Settled[]> {
    const settled: Settled[] = [];
    await this.prisma.$transaction(async (tx) => {
      for (const { session, outcome } of outcomes) {
        // Claim: an overlapping sweep (two workers during a deploy) loses the
        // race here and must not double-record the event or reward.
        const claimed = await tx.session.updateMany({
          where: { id: session.id, retainedAt: null },
          data: { retainedAt: now },
        });
        if (claimed.count === 0) continue;
        const eventId = await this.writeOutcomeEvent(tx, session, outcome);
        settled.push({
          sessionId: session.id,
          userId: session.userId,
          eventId,
          outcome,
          reward:
            outcome === "COMPLETED"
              ? SESSION_COMPLETED_REWARD
              : SESSION_MISSED_REWARD,
          scheduledStartMs: session.scheduledStartTime!.getTime(),
          timezone: session.user.timezone,
        });
      }
    });
    return settled;
  }

  /**
   * Sets the reward on the check-off `SessionEvent` the user wrote (`COMPLETE`
   * or `SKIP`), or writes a `MISSED` event when there is none. Returns the id
   * of the event that carries the reward.
   */
  private async writeOutcomeEvent(
    tx: Prisma.TransactionClient,
    session: OutcomeCandidate,
    outcome: CompletionOutcome,
  ): Promise<bigint> {
    const checkOff =
      outcome === "COMPLETED"
        ? SessionEventType.COMPLETE
        : outcome === "SKIPPED"
          ? SessionEventType.SKIP
          : null;
    const reward =
      outcome === "COMPLETED"
        ? SESSION_COMPLETED_REWARD
        : SESSION_MISSED_REWARD;

    if (checkOff) {
      const existing = await tx.sessionEvent.findFirst({
        where: {
          sessionId: session.id,
          userId: session.userId,
          eventType: checkOff,
        },
        orderBy: { occurredAt: "desc" },
        select: { id: true },
      });
      if (existing) {
        await tx.sessionEvent.updateMany({
          where: { id: existing.id },
          data: { rewardScore: reward },
        });
        return existing.id;
      }
    }

    const event = await tx.sessionEvent.create({
      data: {
        sessionId: session.id,
        userId: session.userId,
        eventType: checkOff ?? SessionEventType.MISSED,
        oldSnapshot: Prisma.JsonNull,
        newSnapshot: this.snapshot(session),
        rewardScore: reward,
      },
      select: { id: true },
    });
    schedulerSessionEvents.add(1, {
      type: checkOff ?? SessionEventType.MISSED,
    });
    return event.id;
  }

  /** Delayed LinUCB reward and, for a completion, preference-matrix
   * reinforcement. Best-effort, outside the transaction. A placement that
   * was not chosen by LinUCB gets no bandit update; the matrix is updated
   * for either policy. */
  private async applyDelayedRewards(settled: Settled[]): Promise<void> {
    for (const s of settled) {
      await this.schedulingFeedback.applyDelayedReward(
        s.userId,
        s.sessionId,
        s.eventId,
        s.reward,
        null,
      );
      if (s.outcome === "COMPLETED") {
        await this.schedulingFeedback.reinforcePreferenceMatrix(
          s.userId,
          s.scheduledStartMs,
          s.timezone,
          PREFERENCE_RETAINED_WEIGHT,
        );
      }
    }
  }

  private snapshot(session: OutcomeCandidate): Prisma.InputJsonValue {
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
