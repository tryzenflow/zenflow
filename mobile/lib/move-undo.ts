import { undoPlacement, updateSession } from "@/api/tasks";
import type { Session, UpdateScope } from "@zenflow/shared";

/**
 * Revert a move from its response. A response with `undoGroupId` reverts the
 * whole group, so a cascade that displaced other sessions comes back too;
 * without one, the session goes back to `before` as before.
 */
export function undoMove(
  response: { undoGroupId?: string | null },
  before: Pick<Session, "id" | "scheduledStartTime" | "durationMinutes">,
  scope?: UpdateScope,
  skipConflicting?: boolean,
) {
  if (response.undoGroupId) return undoPlacement(response.undoGroupId);
  return restoreSessionTime(before, scope, skipConflicting);
}

/**
 * Put a moved session back where it was before the move. Uses the same scope
 * the move used, so a series move reverts the way it went.
 */
export function restoreSessionTime(
  before: Pick<Session, "id" | "scheduledStartTime" | "durationMinutes">,
  scope?: UpdateScope,
  skipConflicting?: boolean,
) {
  if (!before.scheduledStartTime) return Promise.resolve(null);
  return updateSession(before.id, {
    scheduledStartTime: before.scheduledStartTime,
    durationMinutes: before.durationMinutes,
    scope,
    skipConflicting,
  });
}
