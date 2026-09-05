import type { Session } from "@zenflow/shared";
import { describe, expect, it } from "vitest";
import { sessionTypesByDay } from "../week-day-types";

const TZ = "UTC";

function session(overrides: Partial<Session>): Session {
  return {
    id: "s1",
    title: "t",
    note: null,
    durationMinutes: 60,
    deadline: null,
    type: "TASK",
    source: "USER",
    tags: [],
    scheduledStartTime: "2026-09-07T09:00:00.000Z",
    seriesId: null,
    rrule: null,
    sessionIndex: null,
    sessionTotal: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("sessionTypesByDay", () => {
  it("groups sessions by their scheduled day, keyed by dateKey", () => {
    const result = sessionTypesByDay(
      [
        session({
          id: "a",
          type: "TASK",
          scheduledStartTime: "2026-09-07T09:00:00.000Z",
        }),
        session({
          id: "b",
          type: "EXAM",
          scheduledStartTime: "2026-09-08T10:00:00.000Z",
        }),
      ],
      TZ,
    );
    expect(result.get("2026-09-07")).toEqual(["TASK"]);
    expect(result.get("2026-09-08")).toEqual(["EXAM"]);
  });

  it("dedupes multiple sessions of the same type on the same day", () => {
    const result = sessionTypesByDay(
      [
        session({ id: "a", type: "TASK", sessionIndex: 1, sessionTotal: 3 }),
        session({ id: "b", type: "TASK", sessionIndex: 2, sessionTotal: 3 }),
        session({ id: "c", type: "TASK", sessionIndex: 3, sessionTotal: 3 }),
      ],
      TZ,
    );
    expect(result.get("2026-09-07")).toEqual(["TASK"]);
  });

  it("collects distinct types on the same day without duplicates", () => {
    const result = sessionTypesByDay(
      [
        session({ id: "a", type: "TASK" }),
        session({ id: "b", type: "EXAM" }),
        session({ id: "c", type: "TASK" }),
      ],
      TZ,
    );
    expect(result.get("2026-09-07")?.sort()).toEqual(["EXAM", "TASK"]);
  });

  it("skips unscheduled sessions (null scheduledStartTime)", () => {
    const result = sessionTypesByDay(
      [session({ id: "a", scheduledStartTime: null })],
      TZ,
    );
    expect(result.size).toBe(0);
  });

  it("converts the instant into the day using the given timezone", () => {
    // 11pm UTC on the 7th is already the 8th in a +2h zone.
    const result = sessionTypesByDay(
      [
        session({
          id: "a",
          type: "LECTURE",
          scheduledStartTime: "2026-09-07T23:00:00.000Z",
        }),
      ],
      "Europe/Bucharest",
    );
    expect(result.get("2026-09-08")).toEqual(["LECTURE"]);
    expect(result.has("2026-09-07")).toBe(false);
  });

  it("returns an empty map for no sessions", () => {
    expect(sessionTypesByDay([], TZ).size).toBe(0);
  });
});
