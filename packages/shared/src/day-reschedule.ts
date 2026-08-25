/**
 * Implicit same-day repack: creating a session or editing a session's
 * deadline transparently repacks just that one calendar day (no preview, no
 * undo — see `backend/src/scheduler/day-reschedule.service.ts`).
 */
export interface DayRescheduleDiff {
  id: string;
  title: string;
  /** ISO-8601 instant, or null if the session had no prior placement. */
  oldScheduledStartTime: string | null;
  /** ISO-8601 instant. */
  newScheduledStartTime: string;
}

export interface DayRescheduleResult {
  /** 'YYYY-MM-DD' in the user's timezone — the day that was repacked. */
  date: string;
  diffs: DayRescheduleDiff[];
}
