import { describe, expect, it } from "vitest";
import {
  addMonths,
  dateKey,
  getMonthGridDays,
  groupTasksByDate,
  isOutsideMonth,
  isWeekendColumn,
  monthLabel,
  splitCellTasks,
} from "../month-date-math";

describe("getMonthGridDays", () => {
  it("pads June 2026 (starts on a Monday) to a Monday-first 5-week grid", () => {
    // June 1 2026 is a Monday, June 30 a Tuesday — no leading padding, 5
    // trailing days from July needed to complete the last week (5 rows).
    const days = getMonthGridDays(new Date(2026, 5, 15));
    expect(days).toHaveLength(35);
    expect(days[0]).toEqual(new Date(2026, 5, 1));
    expect(days[days.length - 1]).toEqual(new Date(2026, 6, 5));
  });

  it("pads a month that doesn't start on Monday on both ends", () => {
    // February 2026: Feb 1 is a Sunday, Feb 28 a Saturday — needs both
    // leading (Jan 26-31) and trailing (Mar 1) days to complete whole weeks.
    const days = getMonthGridDays(new Date(2026, 1, 10));
    expect(days).toHaveLength(35);
    expect(days[0]).toEqual(new Date(2026, 0, 26));
    expect(days[days.length - 1]).toEqual(new Date(2026, 2, 1));
  });

  it("pads a month that needs a full 6th week (42-day grid)", () => {
    // August 2026: Aug 1 is a Saturday, Aug 31 a Monday — leading Jul 27-31
    // plus a full trailing week (Sep 1-6) push it to 6 weeks.
    const days = getMonthGridDays(new Date(2026, 7, 15));
    expect(days).toHaveLength(42);
    expect(days[0]).toEqual(new Date(2026, 6, 27));
    expect(days[days.length - 1]).toEqual(new Date(2026, 8, 6));
  });

  it("always returns a multiple of 7", () => {
    for (let month = 0; month < 12; month++) {
      const days = getMonthGridDays(new Date(2026, month, 15));
      expect(days.length % 7).toBe(0);
    }
  });
});

describe("isOutsideMonth", () => {
  it("flags leading/trailing adjacent-month days", () => {
    const june = new Date(2026, 5, 15);
    expect(isOutsideMonth(new Date(2026, 4, 31), june)).toBe(true); // May 31
    expect(isOutsideMonth(new Date(2026, 6, 1), june)).toBe(true); // Jul 1
    expect(isOutsideMonth(new Date(2026, 5, 1), june)).toBe(false); // Jun 1
    expect(isOutsideMonth(new Date(2026, 5, 30), june)).toBe(false); // Jun 30
  });
});

describe("isWeekendColumn", () => {
  it("treats Monday-first columns 5 and 6 (Sat/Sun) as weekend", () => {
    expect([0, 1, 2, 3, 4].map(isWeekendColumn)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(isWeekendColumn(5)).toBe(true);
    expect(isWeekendColumn(6)).toBe(true);
  });
});

describe("dateKey / monthLabel / addMonths", () => {
  it("formats a stable grouping key", () => {
    expect(dateKey(new Date(2026, 5, 1))).toBe("2026-06-01");
  });

  it("formats the month header label", () => {
    expect(monthLabel(new Date(2026, 5, 15))).toBe("June 2026");
  });

  it("adds/subtracts calendar months", () => {
    expect(monthLabel(addMonths(new Date(2026, 5, 15), 1))).toBe("July 2026");
    expect(monthLabel(addMonths(new Date(2026, 5, 15), -1))).toBe("May 2026");
    expect(monthLabel(addMonths(new Date(2026, 0, 15), -1))).toBe(
      "December 2025",
    );
  });
});

describe("splitCellTasks", () => {
  it("shows everything with no overflow when at or under the cap", () => {
    expect(splitCellTasks(["a", "b"], 2)).toEqual({
      visible: ["a", "b"],
      overflowCount: 0,
    });
    expect(splitCellTasks(["a"], 2)).toEqual({
      visible: ["a"],
      overflowCount: 0,
    });
    expect(splitCellTasks([], 2)).toEqual({ visible: [], overflowCount: 0 });
  });

  it("caps at 2 and reports the correct overflow count on the 3rd+ task", () => {
    expect(splitCellTasks(["a", "b", "c"], 2)).toEqual({
      visible: ["a", "b"],
      overflowCount: 1,
    });
    expect(splitCellTasks(["a", "b", "c", "d", "e"], 2)).toEqual({
      visible: ["a", "b"],
      overflowCount: 3,
    });
  });

  it("defaults the cap to 2 (the fixed month-grid overflow cap)", () => {
    expect(splitCellTasks(["a", "b", "c"])).toEqual({
      visible: ["a", "b"],
      overflowCount: 1,
    });
  });
});

describe("groupTasksByDate", () => {
  const tz = "UTC";
  function task(id: string, scheduledStartTime: string | null) {
    return { id, scheduledStartTime };
  }

  it("groups tasks by their user-tz scheduled day", () => {
    const tasks = [
      task("a", "2026-06-15T09:00:00.000Z"),
      task("b", "2026-06-15T14:30:00.000Z"),
      task("c", "2026-06-16T09:00:00.000Z"),
    ];
    const grouped = groupTasksByDate(tasks, tz);
    expect(grouped.get("2026-06-15")?.map((t) => t.id)).toEqual(["a", "b"]);
    expect(grouped.get("2026-06-16")?.map((t) => t.id)).toEqual(["c"]);
    expect(grouped.size).toBe(2);
  });

  it("omits unplaced tasks (null scheduledStartTime)", () => {
    const tasks = [task("a", null), task("b", "2026-06-15T09:00:00.000Z")];
    const grouped = groupTasksByDate(tasks, tz);
    expect(grouped.size).toBe(1);
    expect(grouped.get("2026-06-15")?.map((t) => t.id)).toEqual(["b"]);
  });

  it("reasons in the given timezone, not UTC", () => {
    // 2026-06-15T23:30:00Z is already 2026-06-16 local in UTC+2.
    const tasks = [task("a", "2026-06-15T23:30:00.000Z")];
    const grouped = groupTasksByDate(tasks, "Europe/Berlin");
    expect(grouped.has("2026-06-16")).toBe(true);
    expect(grouped.has("2026-06-15")).toBe(false);
  });

  it("sorts each day ascending by start time, whatever order the API returned", () => {
    const tasks = [
      task("noon", "2026-06-15T12:00:00.000Z"),
      task("evening", "2026-06-15T19:45:00.000Z"),
      task("dawn", "2026-06-15T06:15:00.000Z"),
    ];
    const grouped = groupTasksByDate(tasks, tz);
    expect(grouped.get("2026-06-15")?.map((t) => t.id)).toEqual([
      "dawn",
      "noon",
      "evening",
    ]);
  });

  it("sorts every day independently", () => {
    const tasks = [
      task("d16-late", "2026-06-16T18:00:00.000Z"),
      task("d15-late", "2026-06-15T18:00:00.000Z"),
      task("d16-early", "2026-06-16T08:00:00.000Z"),
      task("d15-early", "2026-06-15T08:00:00.000Z"),
    ];
    const grouped = groupTasksByDate(tasks, tz);
    expect(grouped.get("2026-06-15")?.map((t) => t.id)).toEqual([
      "d15-early",
      "d15-late",
    ]);
    expect(grouped.get("2026-06-16")?.map((t) => t.id)).toEqual([
      "d16-early",
      "d16-late",
    ]);
  });

  it("keeps API order for tasks sharing a start time (stable sort)", () => {
    const tasks = [
      task("first", "2026-06-15T09:00:00.000Z"),
      task("second", "2026-06-15T09:00:00.000Z"),
      task("third", "2026-06-15T09:00:00.000Z"),
    ];
    const grouped = groupTasksByDate(tasks, tz);
    expect(grouped.get("2026-06-15")?.map((t) => t.id)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });

  it("sorts in user-tz order across a UTC day boundary", () => {
    // Both land on 2026-06-16 in UTC+2; the 23:30Z one is 01:30 local and so
    // must sort *before* the 08:00Z (10:00 local) task, even though its raw
    // UTC timestamp is later in the string sense only by date.
    const tasks = [
      task("morning", "2026-06-16T08:00:00.000Z"),
      task("just-after-midnight", "2026-06-15T23:30:00.000Z"),
    ];
    const grouped = groupTasksByDate(tasks, "Europe/Berlin");
    expect(grouped.get("2026-06-16")?.map((t) => t.id)).toEqual([
      "just-after-midnight",
      "morning",
    ]);
  });
});
