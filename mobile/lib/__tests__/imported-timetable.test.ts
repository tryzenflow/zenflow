import type { Session } from "@zenflow/shared";
import { describe, expect, it } from "vitest";
import { importedTimetable } from "../imported-timetable";

function session(id: string, over: Partial<Session> = {}): Session {
  return {
    id,
    title: id,
    source: "PORTAL",
    scheduledStartTime: "2026-10-19T01:00:00.000Z",
    ...over,
  } as Session;
}

describe("importedTimetable", () => {
  it("keeps synced sessions and drops the ones the user made", () => {
    const out = importedTimetable(
      [session("mine", { source: "USER" }), session("lecture")],
      10,
    );
    expect(out.map((s) => s.id)).toEqual(["lecture"]);
  });
  it("drops unscheduled rows", () => {
    expect(
      importedTimetable([session("a", { scheduledStartTime: null })], 10),
    ).toEqual([]);
  });
  it("sorts by start time, not input order", () => {
    const out = importedTimetable(
      [
        session("late", { scheduledStartTime: "2026-10-19T09:00:00.000Z" }),
        session("early", { scheduledStartTime: "2026-10-19T01:00:00.000Z" }),
        session("lms", {
          source: "LMS",
          scheduledStartTime: "2026-10-19T05:00:00.000Z",
        }),
      ],
      10,
    );
    expect(out.map((s) => s.id)).toEqual(["early", "lms", "late"]);
  });
  it("caps the list at the limit", () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      session(`s${i}`, { scheduledStartTime: `2026-10-19T0${i}:00:00.000Z` }),
    );
    expect(importedTimetable(many, 6)).toHaveLength(6);
  });
});
