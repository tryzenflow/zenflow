import { describe, expect, it } from "vitest";
import {
  SESSION_TYPE_META,
  formatDeadlineLabel,
  formatDeadlineShort,
} from "../session-type";

const UTC = "UTC";

describe("SESSION_TYPE_META", () => {
  it("covers every session type", () => {
    expect(Object.keys(SESSION_TYPE_META).sort()).toEqual([
      "ASSIGNMENT",
      "DND",
      "EXAM",
      "LECTURE",
      "TASK",
    ]);
  });
});

describe("formatDeadlineLabel", () => {
  const now = new Date("2026-03-02T12:00:00Z");

  it("says 'today' for a same-day deadline", () => {
    expect(formatDeadlineLabel("2026-03-02T09:00:00Z", UTC, now)).toBe(
      "due today 9:00 AM",
    );
  });

  it("says 'tomorrow' for a next-day deadline", () => {
    expect(formatDeadlineLabel("2026-03-03T17:30:00Z", UTC, now)).toBe(
      "due tomorrow 5:30 PM",
    );
  });

  it("uses an absolute date (no year) later in the same year", () => {
    expect(formatDeadlineLabel("2026-03-04T09:00:00Z", UTC, now)).toBe(
      "due Mar 4, 9:00 AM",
    );
  });

  it("appends the year when the deadline is in a different year", () => {
    expect(formatDeadlineLabel("2027-01-10T08:15:00Z", UTC, now)).toBe(
      "due Jan 10 2027, 8:15 AM",
    );
  });

  it("evaluates 'today' in the given timezone, not UTC", () => {
    // 2026-03-03T02:00Z is still Mar 2 in America/New_York (UTC-5).
    expect(
      formatDeadlineLabel(
        "2026-03-03T02:00:00Z",
        "America/New_York",
        new Date("2026-03-02T18:00:00Z"),
      ),
    ).toBe("due today 9:00 PM");
  });
});

describe("formatDeadlineShort", () => {
  const ref = new Date("2026-03-02T12:00:00Z");

  it("shows just the time when the deadline is on the reference day", () => {
    expect(formatDeadlineShort("2026-03-02T09:00:00Z", UTC, ref)).toBe(
      "9:00 AM",
    );
  });

  it("says 'tomorrow' for the next day", () => {
    expect(formatDeadlineShort("2026-03-03T23:00:00Z", UTC, ref)).toBe(
      "tomorrow",
    );
  });

  it("shows a bare month/day further out in the same year", () => {
    expect(formatDeadlineShort("2026-03-09T09:00:00Z", UTC, ref)).toBe("Mar 9");
  });

  it("appends the year across a year boundary", () => {
    expect(formatDeadlineShort("2027-01-10T08:15:00Z", UTC, ref)).toBe(
      "Jan 10 2027",
    );
  });
});
