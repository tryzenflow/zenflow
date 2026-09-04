import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import {
  Prisma,
  SchedulingModel,
  SessionEventType,
  SessionSource,
  SessionType,
} from "../../../generated/prisma";
import { PrismaService } from "../../prisma/prisma.service";
import { RETAINED_BATCH_SIZE, RETAINED_GRACE_MS } from "../../common/constants";
import { SESSION_RETAINED_REWARD } from "../constants";
import { BanditService } from "../../bandit/bandit.service";
import { BanditArmStateRepository } from "../../bandit/bandit-arm-state.repository";

type RetainedCandidate = Prisma.SessionGetPayload<{
  select: {
    id: true;
    userId: true;
    type: true;
    scheduledStartTime: true;
    durationMinutes: true;
    tags: { select: { name: true } };
  };
}>;

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
 * also delivers the delayed `+1` reward to that arm (ADR-0001 §9).
 */
@Injectable()
export class RetainedSessionsService {
  private readonly logger = new Logger(RetainedSessionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bandit: BanditService,
    private readonly armStates: BanditArmStateRepository,
  ) {}

  /** Every 30 minutes. `now` is injectable for tests. */
  @Cron(CronExpression.EVERY_30_MINUTES)
  async handleCron(): Promise<void> {
    const count = await this.sweep();
    if (count > 0) {
      this.logger.log(`Marked ${count} session(s) RETAINED`);
    }
  }

  async sweep(now = new Date(), userId?: string): Promise<number> {
    const graceMs = RETAINED_GRACE_MS;
    let total = 0;
    let cursor: string | undefined;

    for (;;) {
      const candidates: RetainedCandidate[] =
        await this.prisma.session.findMany({
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
          },
          orderBy: { id: "asc" },
          take: RETAINED_BATCH_SIZE,
          ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        });

      if (candidates.length === 0) break;
      cursor = candidates[candidates.length - 1].id;

      // Keep only rows whose interval (plus grace) has fully elapsed. Rows that
      // haven't yet are left untouched and stepped over by the cursor.
      const elapsed = candidates.filter((s) => {
        const end =
          s.scheduledStartTime!.getTime() + s.durationMinutes * 60_000;
        return end + graceMs <= now.getTime();
      });

      if (elapsed.length > 0) {
        const rewarded: {
          sessionId: string;
          userId: string;
          eventId: bigint;
        }[] = [];

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
            });
          }
        });
        total += elapsed.length;

        // Delayed LinUCB reward — best-effort, outside the transaction.
        for (const r of rewarded) {
          await this.applyRetainedFeedback(r.userId, r.sessionId, r.eventId);
        }
      }

      if (candidates.length < RETAINED_BATCH_SIZE) break;
    }

    return total;
  }

  private async applyRetainedFeedback(
    userId: string,
    sessionId: string,
    eventId: bigint,
  ): Promise<void> {
    try {
      const proposal = await this.prisma.slotProposal.findFirst({
        where: {
          sessionId,
          primaryPolicy: SchedulingModel.LINUCB,
          selectedArm: { not: null },
        },
        orderBy: { timestamp: "desc" },
      });
      if (!proposal?.selectedArm) return;

      const arm = proposal.selectedArm;
      const state = (await this.armStates.loadAll(userId))[arm];
      const res = await this.bandit.update(
        arm,
        proposal.featureVector,
        SESSION_RETAINED_REWARD,
        { A: state.A, b: state.b },
      );
      if (res) {
        await this.armStates.save(userId, arm, res.A, res.b, state.version);
      }
      await this.prisma.sessionEvent.update({
        where: { id: eventId },
        data: {
          slotProposalId: proposal.id,
          policy: SchedulingModel.LINUCB,
        },
      });
    } catch (err) {
      this.logger.warn(
        `bandit RETAINED feedback failed for session ${sessionId}: ${
          (err as Error).message
        }`,
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
