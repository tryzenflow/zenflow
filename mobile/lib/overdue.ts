import type { Session } from "@zenflow/shared";

/**
 * Would rescheduling a session to `newStartISO` place its start *after* its
 * deadline? `false` when the session has no deadline (nothing to be late for).
 *
 * This is the drag-time guard: the calendar lets you drop a flexible TASK
 * anywhere, and dropping it past its own deadline is almost always a slip —
 * callers confirm before hitting the API. Mirrors `@zenflow/core`'s
 * `placementQualifier` "pastDeadline" branch, but takes a *prospective* start
 * rather than a committed `Session`.
 */
export function isPastDeadlineDrop(
  newStartISO: string,
  deadlineISO: string | null | undefined,
): boolean {
  if (!deadlineISO) return false;
  return new Date(newStartISO).getTime() > new Date(deadlineISO).getTime();
}

/**
 * Is this session *currently* scheduled to start after its deadline? Drives the
 * "late" annotation (chip / tint) once a past-deadline reschedule is confirmed.
 * Purely derived — there is no persisted "overdue" state (see
 * `packages/core/src/task-card.ts`).
 */
export function isSessionPastDeadline(session: {
  scheduledStartTime?: Session["scheduledStartTime"];
  deadline?: Session["deadline"];
}): boolean {
  if (!session.scheduledStartTime || !session.deadline) return false;
  return (
    new Date(session.scheduledStartTime).getTime() >
    new Date(session.deadline).getTime()
  );
}
