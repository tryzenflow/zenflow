import { updateSession } from "@/api/tasks";
import type { Session, UpdateScope } from "@zenflow/shared";

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
