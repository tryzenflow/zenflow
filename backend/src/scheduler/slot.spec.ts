import {
  overlapsAny,
  preferenceIndex,
  workWindowFor,
  workWindowMinutes,
} from "./slot";
import { PREFERENCE_MATRIX_LENGTH } from "@zenflow/shared";

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

describe("workWindowMinutes", () => {
  it("non-wrap window is workEnd - workStart", () => {
    // 09:00 → 17:00 = 480 min
    expect(workWindowMinutes(540, 1020)).toBe(480);
  });

  it("wrap window crosses midnight (22:00 → 04:00 = 360 min)", () => {
    expect(workWindowMinutes(1320, 240)).toBe(360);
  });

  it("midnight-end (workEnd = 0) counts to the day's end", () => {
    // 22:00 → 00:00 = 120 min (wraps, since 0 <= 1320)
    expect(workWindowMinutes(1320, 0)).toBe(120);
  });
});

describe("preferenceIndex — 7×8 (3-hour) signed matrix index", () => {
  it("maps Monday 00:00 to index 0 (day 0, bucket 0)", () => {
    // 2026-06-08 is a Monday.
    expect(preferenceIndex(new Date("2026-06-08T00:00:00Z"), "UTC")).toBe(0);
  });

  it("maps all four 15-min sub-slots within an hour to the same bucket", () => {
    // Monday 09:00–09:45 → slotOfDay = floor(9/3) = 3; all four 15-min marks
    // within the 09:xx hour fall in the same 09–12 bucket (index 3).
    const base = "2026-06-08T09:";
    expect(preferenceIndex(new Date(`${base}00:00Z`), "UTC")).toBe(3);
    expect(preferenceIndex(new Date(`${base}15:00Z`), "UTC")).toBe(3);
    expect(preferenceIndex(new Date(`${base}30:00Z`), "UTC")).toBe(3);
    expect(preferenceIndex(new Date(`${base}45:00Z`), "UTC")).toBe(3);
  });

  it("offsets each weekday by 8 buckets", () => {
    // 2026-06-09 is a Tuesday (day 1): 09:00 → 1*8 + floor(9/3) = 8 + 3 = 11.
    expect(preferenceIndex(new Date("2026-06-09T09:00:00Z"), "UTC")).toBe(11);
  });

  it("maps Sunday 21:00–23:59 to the last cell (55), in-bounds", () => {
    // 2026-06-14 is a Sunday (day 6): slotOfDay = floor(21/3) = 7 → 6*8 + 7 = 55.
    const idx = preferenceIndex(new Date("2026-06-14T21:00:00Z"), "UTC");
    expect(idx).toBe(55);
    expect(idx).toBe(PREFERENCE_MATRIX_LENGTH - 1);
    // 23:59 falls in the same bucket (floor(23/3) = 7).
    expect(preferenceIndex(new Date("2026-06-14T23:59:00Z"), "UTC")).toBe(55);
  });

  it("honours the user's timezone for the wall-clock bucket", () => {
    // 2026-06-08T13:00:00Z is Monday 09:00 in New York (UTC-4 in June).
    // floor(9/3) = 3 → index 3.
    expect(
      preferenceIndex(new Date("2026-06-08T13:00:00Z"), "America/New_York"),
    ).toBe(3);
  });
});

describe("workWindowFor", () => {
  it("non-wrap window keeps start and end on the same calendar day", () => {
    const win = workWindowFor("2026-06-08", 540, 1020, "UTC");
    expect(new Date(win.start).toISOString()).toBe("2026-06-08T09:00:00.000Z");
    expect(new Date(win.end).toISOString()).toBe("2026-06-08T17:00:00.000Z");
  });

  it("wrap window puts end on the next calendar day", () => {
    // 22:00 day D → 04:00 day D+1
    const win = workWindowFor("2026-06-08", 1320, 240, "UTC");
    expect(new Date(win.start).toISOString()).toBe("2026-06-08T22:00:00.000Z");
    expect(new Date(win.end).toISOString()).toBe("2026-06-09T04:00:00.000Z");
  });

  it("midnight-end wrap lands at 00:00 of the next day", () => {
    const win = workWindowFor("2026-06-08", 1320, 0, "UTC");
    expect(new Date(win.start).toISOString()).toBe("2026-06-08T22:00:00.000Z");
    expect(new Date(win.end).toISOString()).toBe("2026-06-09T00:00:00.000Z");
  });

  it("is DST-correct across a spring-forward boundary (via minutesToUtc)", () => {
    // America/New_York springs forward 2026-03-08 02:00 → 03:00 (loses an hour).
    // A 22:00 → 04:00 window anchored to 2026-03-07 spans that transition: the
    // wall-clock end on 03-08 04:00 is EDT (UTC-4), the start 03-07 22:00 is EST
    // (UTC-5), so the absolute span is 5h, not 6h.
    const win = workWindowFor("2026-03-07", 1320, 240, "America/New_York");
    expect(new Date(win.start).toISOString()).toBe("2026-03-08T03:00:00.000Z");
    expect(new Date(win.end).toISOString()).toBe("2026-03-08T08:00:00.000Z");
  });
});
