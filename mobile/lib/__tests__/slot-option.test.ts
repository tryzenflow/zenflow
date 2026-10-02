import { describe, expect, it } from "vitest";
import { buildSlotOptions, dayWord, formatRange } from "../slot-option";

const TZ = "UTC";
/** Tue 30 Jun 2026, midday. */
const NOW = new Date("2026-06-30T12:00:00.000Z");

/**
 * `formatRange` formats in the *process's* zone, because its input contract is
 * a wall-clock `Date` — the same invariant the rest of the calendar follows
 * (CLAUDE.md: never a bare `new Date()` in day/grid logic). So these build
 * local-field Dates rather than UTC instants, and the assertion holds whatever
 * machine's zone the suite runs in.
 */
const wall = (h: number, m = 0) => new Date(2026, 5, 30, h, m);

describe("formatRange", () => {
  it("drops the first meridiem when both ends share a half-day", () => {
    expect(formatRange(wall(19), wall(20))).toBe("7:00 – 8:00 PM");
  });

  it("keeps both meridiems when the range crosses noon", () => {
    expect(formatRange(wall(11), wall(12))).toBe("11:00 AM – 12:00 PM");
  });

  it("keeps both meridiems when the range crosses midnight", () => {
    expect(formatRange(wall(23), wall(1))).toBe("11:00 PM – 1:00 AM");
  });
});

describe("dayWord", () => {
  it("says today / tomorrow relative to the injected now", () => {
    expect(dayWord(new Date("2026-06-30T08:00:00Z"), NOW)).toBe("today");
    expect(dayWord(new Date("2026-07-01T08:00:00Z"), NOW)).toBe("tomorrow");
  });

  it("falls back to EEE MMM d further out", () => {
    expect(dayWord(new Date("2026-07-04T08:00:00Z"), NOW)).toBe("Sat Jul 4");
  });
});

describe("buildSlotOptions", () => {
  const base = { durationMinutes: 60 };

  it("gives each option its own date, day before time", () => {
    const [p, a] = buildSlotOptions(
      {
        ...base,
        primarySlot: "2026-06-30T01:00:00Z",
        alternativeSlot: "2026-06-30T05:00:00Z",
      },
      TZ,
      NOW,
    );
    expect(p.label).toBe("Today · 1:00 – 2:00 AM");
    expect(a.label).toBe("Today · 5:00 – 6:00 AM");
    expect(a.dayDelta).toBe("");
  });

  it("flags a cross-day alternative (AC: the day must read unambiguously)", () => {
    const [p, a] = buildSlotOptions(
      {
        ...base,
        primarySlot: "2026-07-03T11:00:00Z",
        alternativeSlot: "2026-07-04T10:00:00Z",
      },
      TZ,
      NOW,
    );
    expect(p.day).toBe("Fri Jul 3");
    expect(a.day).toBe("Sat Jul 4");
    expect(p.day).not.toBe(a.day);
    expect(a.dayDelta).toBe("+1 day");
    expect(p.label).toContain("Fri Jul 3");
    expect(a.label).toContain("Sat Jul 4");
  });

  it("flags a backwards cross-day", () => {
    const [, a] = buildSlotOptions(
      {
        ...base,
        primarySlot: "2026-07-04T10:00:00Z",
        alternativeSlot: "2026-07-03T10:00:00Z",
      },
      TZ,
      NOW,
    );
    expect(a.dayDelta).toBe("−1 day");
  });

  it("pluralises a multi-day jump", () => {
    const [, a] = buildSlotOptions(
      {
        ...base,
        primarySlot: "2026-07-01T10:00:00Z",
        alternativeSlot: "2026-07-04T10:00:00Z",
      },
      TZ,
      NOW,
    );
    expect(a.dayDelta).toBe("+3 days");
  });

  it("orders [primary, alternative] and leaves the primary's delta empty", () => {
    const [p, a] = buildSlotOptions(
      {
        ...base,
        primarySlot: "2026-06-30T01:00:00Z",
        alternativeSlot: "2026-07-01T01:00:00Z",
      },
      TZ,
      NOW,
    );
    expect(p.kind).toBe("primary");
    expect(a.kind).toBe("alternative");
    expect(p.dayDelta).toBe("");
  });

  it("reads the wall clock in the given timezone, not UTC", () => {
    const [p] = buildSlotOptions(
      {
        ...base,
        primarySlot: "2026-06-30T01:00:00Z",
        alternativeSlot: "2026-06-30T05:00:00Z",
      },
      "Asia/Ho_Chi_Minh",
      new Date("2026-06-30T01:00:00Z"),
    );
    // 01:00Z is 08:00 in Ho Chi Minh — the heuristic's MORNING band.
    expect(p.time).toBe("8:00 AM");
  });
});
