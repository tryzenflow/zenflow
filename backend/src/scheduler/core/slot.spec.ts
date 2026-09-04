import { addDaysStr, dayDiffStr, deadlineDayStr, overlapsAny } from "./slot";

describe("overlapsAny — half-open interval overlap", () => {
  const occ = [
    { start: 100, end: 200 },
    { start: 300, end: 400 },
  ];

  it("is true when the candidate overlaps one interval", () => {
    expect(overlapsAny(occ, 150, 250)).toBe(true);
  });

  it("is false in a gap between intervals", () => {
    expect(overlapsAny(occ, 200, 300)).toBe(false);
  });

  it("treats touching boundaries as non-overlapping (half-open)", () => {
    // ends exactly at an interval's start, and starts exactly at an end.
    expect(overlapsAny(occ, 50, 100)).toBe(false);
    expect(overlapsAny(occ, 400, 500)).toBe(false);
  });

  it("is true when the candidate fully contains an interval", () => {
    expect(overlapsAny(occ, 0, 1000)).toBe(true);
  });

  it("is false against an empty occupied set", () => {
    expect(overlapsAny([], 100, 200)).toBe(false);
  });
});

describe("deadlineDayStr — the day a deadline should be scheduled within", () => {
  const tz = "UTC";

  it("steps back to the PRECEDING day for a deadline exactly at midnight", () => {
    // "Tomorrow"/"No rush"/"This week" etc. — an exclusive period ceiling,
    // one day past the intended last day (see deadline-options.ts).
    expect(deadlineDayStr(new Date("2026-10-01T00:00:00.000Z"), tz)).toBe(
      "2026-09-30",
    );
  });

  it("is a no-op for a deadline at a real time-of-day within a day", () => {
    // "Today" — anchor + 3h, never midnight.
    expect(deadlineDayStr(new Date("2026-08-27T18:45:00.000Z"), tz)).toBe(
      "2026-08-27",
    );
  });

  it("crosses a month boundary correctly", () => {
    expect(deadlineDayStr(new Date("2027-01-01T00:00:00.000Z"), tz)).toBe(
      "2026-12-31",
    );
  });

  it("honours a non-UTC timezone's midnight, not UTC's", () => {
    // 00:00 in America/New_York (UTC-4 in late Aug, EDT) is 04:00 UTC — a
    // bare UTC-day step-back would land on the wrong side of that offset.
    expect(
      deadlineDayStr(new Date("2026-08-28T04:00:00.000Z"), "America/New_York"),
    ).toBe("2026-08-27");
  });
});

describe("dayDiffStr — whole calendar days between two date strings", () => {
  it("is 0 for the same day", () => {
    expect(dayDiffStr("2026-06-15", "2026-06-15")).toBe(0);
  });

  it("counts forward and backward", () => {
    expect(dayDiffStr("2026-06-15", "2026-06-18")).toBe(3);
    expect(dayDiffStr("2026-06-18", "2026-06-15")).toBe(-3);
  });

  it("crosses month and year boundaries", () => {
    expect(dayDiffStr("2026-01-30", "2026-02-02")).toBe(3);
    expect(dayDiffStr("2026-12-31", "2027-01-01")).toBe(1);
  });

  it("is DST-agnostic (pure UTC-midnight math)", () => {
    // spans the US spring-forward — still a whole number of days
    expect(dayDiffStr("2026-03-07", "2026-03-09")).toBe(2);
  });

  it("round-trips against addDaysStr", () => {
    expect(dayDiffStr("2026-06-15", addDaysStr("2026-06-15", 42))).toBe(42);
  });
});
