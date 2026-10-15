import type { Session } from "@zenflow/shared";

/**
 * The sessions an LMS or portal sync put on the calendar (not the ones the
 * user made), in start order, capped at `limit`. Unscheduled rows are left out.
 * RN-free so it can be unit-tested (`lib/__tests__/imported-timetable.test.ts`).
 */
export function importedTimetable(
  sessions: readonly Session[],
  limit: number,
): Session[] {
  return sessions
    .filter(
      (s): s is Session & { scheduledStartTime: string } =>
        s.source !== "USER" && s.scheduledStartTime !== null,
    )
    .sort(
      (a, b) =>
        Date.parse(a.scheduledStartTime) - Date.parse(b.scheduledStartTime),
    )
    .slice(0, limit);
}
