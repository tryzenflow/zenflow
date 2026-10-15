import type { Session } from "@zenflow/shared";
import { describe, expect, it } from "vitest";
import { buildDayBar, dayBarsByDay } from "../day-bar";

const TZ = "UTC";

function session(
  start: string,
  minutes: number,
  type: Session["type"],
  id = start,
): Session {
  return {
    id,
    title: "t",
    note: null,
    location: null,
    durationMinutes: minutes,
    deadline: null,
    late: false,
    completedAt: null,
    anchor: "AUTO",
    anchoredAt: null,
    placementReason: null,
    skipped: false,
    type,
    source: "USER",
    tags: [],
    reminders: [],
    scheduledStartTime: `2026-10-15T${start}:00.000Z`,
    seriesId: null,
    rrule: null,
    timetableGroupId: null,
    courseKey: null,
    sessionIndex: null,
    sessionTotal: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  } as Session;
}

describe("buildDayBar", () => {
  it("is empty for a day with no sessions", () => {
    expect(buildDayBar([], TZ)).toEqual({ types: [], segments: [] });
  });

  it("draws timetable, gap, task in time order", () => {
    const bar = buildDayBar(
      [session("14:00", 60, "TASK"), session("08:00", 120, "LECTURE")],
      TZ,
    );
    expect(bar.segments).toEqual([
      { kind: "LECTURE", flex: 120 },
      { kind: "gap", flex: 240 },
      { kind: "TASK", flex: 60 },
    ]);
    expect(bar.types).toEqual(["LECTURE", "TASK"]);
  });

  it("merges adjacent sessions of one type and skips short gaps", () => {
    const bar = buildDayBar(
      [session("09:00", 60, "TASK"), session("10:10", 50, "TASK", "b")],
      TZ,
    );
    expect(bar.segments).toEqual([{ kind: "TASK", flex: 110 }]);
  });

  it("draws an overlap once", () => {
    const bar = buildDayBar(
      [session("09:00", 120, "LECTURE"), session("10:00", 120, "TASK", "b")],
      TZ,
    );
    expect(bar.segments).toEqual([
      { kind: "LECTURE", flex: 120 },
      { kind: "TASK", flex: 60 },
    ]);
  });

  it("stops a session at midnight", () => {
    const bar = buildDayBar([session("23:00", 180, "TASK")], TZ);
    expect(bar.segments).toEqual([{ kind: "TASK", flex: 60 }]);
  });
});

describe("dayBarsByDay", () => {
  it("keys bars by day", () => {
    const bars = dayBarsByDay([session("09:00", 60, "TASK")], TZ);
    expect([...bars.keys()]).toHaveLength(1);
  });
});
