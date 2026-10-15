import { Prisma, SessionEventType } from "../../../generated/prisma";
import type { PrismaService } from "../../prisma/prisma.service";

/**
 * Events that carry a settled reward (ADR-0022): a graded `MOVE`, a `MISSED`,
 * a legacy `RETAINED`, and a `COMPLETE` or `SKIP` whose reward is set. An
 * unsettled check-off (`rewardScore` 0) and `SYSTEM_MOVE` carry no signal.
 */
export function rewardEventWhere(
  userId: string,
): Prisma.SessionEventWhereInput {
  return {
    userId,
    OR: [
      {
        eventType: {
          in: [
            SessionEventType.MOVE,
            SessionEventType.MISSED,
            SessionEventType.RETAINED,
          ],
        },
      },
      {
        eventType: { in: [SessionEventType.COMPLETE, SessionEventType.SKIP] },
        rewardScore: { not: 0 },
      },
    ],
  };
}

/**
 * The user's reward-event count, the input to the adaptive LinUCB/preference
 * weights and the `SlotProposal.observationCount` stamp.
 */
export function loadObservationCount(
  prisma: Pick<PrismaService, "sessionEvent">,
  userId: string,
): Promise<number> {
  return prisma.sessionEvent.count({ where: rewardEventWhere(userId) });
}
