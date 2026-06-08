import {
  displayDayRange,
  monthRange,
  sumWorkMinutes,
  viewDayRange,
  weekStartStr,
} from "./horizon";

describe("weekStartStr", () => {
  it("returns the Monday of the week (2026-06-10 is a Wednesday)", () => {
    expect(weekStartStr("2026-06-10")).toBe("2026-06-08");
  });
  it("is a no-op on a Monday", () => {
    expect(weekStartStr("2026-06-08")).toBe("2026-06-08");
  });
});

describe("monthRange", () => {
  it("spans the first to last calendar day", () => {
    expect(monthRange("2026-06-15")).toEqual({
      startStr: "2026-06-01",
      endStr: "2026-06-30",
    });
  });
});

describe("viewDayRange", () => {
  it("day → single day", () => {
    expect(viewDayRange("day", "2026-06-10")).toEqual({
      startStr: "2026-06-10",
      endStr: "2026-06-10",
    });
  });
  it("week → Mon–Sun", () => {
    expect(viewDayRange("week", "2026-06-10")).toEqual({
      startStr: "2026-06-08",
      endStr: "2026-06-14",
    });
  });
  it("month → whole month", () => {
    expect(viewDayRange("month", "2026-06-10")).toEqual({
      startStr: "2026-06-01",
      endStr: "2026-06-30",
    });
  });
});

describe("displayDayRange", () => {
  it("day → identical to viewDayRange (no padding)", () => {
    expect(displayDayRange("day", "2026-06-10")).toEqual(
      viewDayRange("day", "2026-06-10"),
    );
  });

  it("week → identical to viewDayRange (no padding)", () => {
    expect(displayDayRange("week", "2026-06-10")).toEqual(
      viewDayRange("week", "2026-06-10"),
    );
  });

  it("month starting Thursday pads the grid into the previous month", () => {
    // Oct 2026: Oct 1 is a Thursday, Oct 31 is a Saturday.
    // Grid = Mon 2026-09-28 .. Sun 2026-11-01.
    expect(displayDayRange("month", "2026-10-15")).toEqual({
      startStr: "2026-09-28",
      endStr: "2026-11-01",
    });
  });

  it("month starting Monday has no leading pad", () => {
    // Jun 2026: Jun 1 is a Monday, Jun 30 is a Tuesday.
    // Grid = Mon 2026-06-01 .. Sun 2026-07-05.
    expect(displayDayRange("month", "2026-06-15")).toEqual({
      startStr: "2026-06-01",
      endStr: "2026-07-05",
    });
  });
});

describe("sumWorkMinutes", () => {
  it("counts only work days in the range", () => {
    // Mon–Sun, 8h workday (480 min), Mon–Fri → 5 × 480 = 2400.
    expect(
      sumWorkMinutes("2026-06-08", "2026-06-14", 540, 1020, [1, 2, 3, 4, 5]),
    ).toBe(2400);
  });

  it("counts each effective minute once for a wrap window (start-day anchored)", () => {
    // 22:00 → 04:00 = 360 min/day. Mon–Fri over the week → 5 × 360 = 1800.
    // The post-midnight tail is NOT double-counted on the following day.
    expect(
      sumWorkMinutes("2026-06-08", "2026-06-14", 1320, 240, [1, 2, 3, 4, 5]),
    ).toBe(1800);
  });
});
