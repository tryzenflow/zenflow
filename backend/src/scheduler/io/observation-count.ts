import { SessionEventType } from "../../../generated/prisma";
import type { PrismaService } from "../../prisma/prisma.service";

/**
 * The user's reward-event count (user MOVE + RETAINED; scheduler-initiated
 * `SYSTEM_MOVE`s carry no signal and are excluded) - the input to the
 * adaptive LinUCB/preference weights (`core/adaptive-weights.ts`) and the
 * `SlotProposal.observationCount` stamp.
 */
export function loadObservationCount(
  prisma: Pick<PrismaService, "sessionEvent">,
  userId: string,
): Promise<number> {
  return prisma.sessionEvent.count({
    where: {
      userId,
      eventType: { in: [SessionEventType.MOVE, SessionEventType.RETAINED] },
    },
  });
}
