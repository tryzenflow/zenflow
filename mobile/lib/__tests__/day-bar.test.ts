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

  it("places each session at its time of day", () => {
    const bar = buildDayBar(
      [session("14:00", 60, "TASK"), session("08:00", 120, "LECTURE")],
      TZ,
    );
    expect(bar.segments).toEqual([
      { kind: "LECTURE", start: 480, end: 600 },
      { kind: "TASK", start: 840, end: 900 },
    ]);
    expect(bar.types).toEqual(["LECTURE", "TASK"]);
  });

  it("merges back to back sessions of one type", () => {
    const bar = buildDayBar(
      [session("09:00", 60, "TASK"), session("10:00", 50, "TASK", "b")],
      TZ,
    );
    expect(bar.segments).toEqual([{ kind: "TASK", start: 540, end: 650 }]);
  });

  it("draws an overlap once", () => {
    const bar = buildDayBar(
      [session("09:00", 120, "LECTURE"), session("10:00", 120, "TASK", "b")],
      TZ,
    );
    expect(bar.segments).toEqual([
      { kind: "LECTURE", start: 540, end: 660 },
      { kind: "TASK", start: 660, end: 720 },
    ]);
  });

  it("stops a session at midnight", () => {
    const bar = buildDayBar([session("23:00", 180, "TASK")], TZ);
    expect(bar.segments).toEqual([{ kind: "TASK", start: 1380, end: 1440 }]);
  });
});

describe("dayBarsByDay", () => {
  it("keys bars by day", () => {
    const bars = dayBarsByDay([session("09:00", 60, "TASK")], TZ);
    expect([...bars.keys()]).toHaveLength(1);
  });

  it("carries the part past midnight to the next day", () => {
    const bars = dayBarsByDay([session("23:00", 180, "TASK")], TZ);
    expect(bars.get("2026-10-15")?.segments).toEqual([{ kind: "TASK", start: 1380, end: 1440 }]);
    expect(bars.get("2026-10-16")?.segments).toEqual([{ kind: "TASK", start: 0, end: 120 }]);
  });
});
