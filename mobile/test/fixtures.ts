import type { Session } from "@zenflow/shared";

/** A Session with sensible defaults; override only what a test cares about. */
export function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "s1",
    title: "Study session",
    note: null,
    location: null,
    durationMinutes: 60,
    deadline: null,
    type: "LECTURE",
    source: "USER",
    tags: [],
    scheduledStartTime: "2026-10-15T03:00:00.000Z",
    seriesId: null,
    rrule: null,
    timetableGroupId: null,
    sessionIndex: null,
    sessionTotal: null,
    reminders: [],
    late: false,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}
