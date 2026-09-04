import { Prisma, SessionEventType } from "../../generated/prisma";
import type { SessionRow } from "./types/session-row";
import { toSessionSnapshot } from "./session-mapper";
import { SESSION_MOVE_REWARD } from "../scheduler/constants";

/**
 * `SessionEvent` payload builders (`docs/adr/0002-scheduling-simplification.md`).
 * Pure — they return the `data` object; the caller does the `tx.sessionEvent.create`.
 */

/** A `CREATE` event for a freshly-inserted row. `seriesId` groups a `sessionCount`
 * batch so `DELETE /sessions/series/:id` can revert it (issue #32). */
export function createEventData(
  row: SessionRow,
  userId: string,
  seriesId?: string,
): Prisma.SessionEventUncheckedCreateInput {
  return {
    sessionId: row.id,
    userId,
    eventType: SessionEventType.CREATE,
    ...(seriesId ? { seriesId } : {}),
    newSnapshot: toSessionSnapshot(row),
  };
}

/** A `MOVE` event for a user drag/resize of a scheduled TASK. `dragDistanceMinutes`
 * is `0` for a resize-only change. */
export function moveEventData(args: {
  sessionId: string;
  userId: string;
  oldStart: Date;
  oldDurationMinutes: number;
  newStart: Date;
  newDurationMinutes: number;
  dragDistanceMinutes: number;
}): Prisma.SessionEventUncheckedCreateInput {
  return {
    sessionId: args.sessionId,
    userId: args.userId,
    eventType: SessionEventType.MOVE,
    oldSnapshot: {
      scheduledStartTime: args.oldStart.toISOString(),
      durationMinutes: args.oldDurationMinutes,
    },
    newSnapshot: {
      scheduledStartTime: args.newStart.toISOString(),
      durationMinutes: args.newDurationMinutes,
    },
    dragDistanceMinutes: args.dragDistanceMinutes,
    rewardScore: SESSION_MOVE_REWARD,
  };
}
