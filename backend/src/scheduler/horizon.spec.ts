import {
  displayDayRange,
  endOfPeriod,
  monthRange,
  periodBoundsStr,
  periodRange,
  sumWorkMinutes,
  viewDayRange,
  weekStartStr,
} from "./horizon";

const iso = (d: Date) => d.toISOString();

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

describe("periodBoundsStr", () => {
  it("day → that day and the next day", () => {
    expect(periodBoundsStr("day", "2026-06-09")).toEqual({
      startStr: "2026-06-09",
      nextStr: "2026-06-10",
    });
  });
  it("week → Monday and the following Monday", () => {
    // 2026-06-10 is a Wednesday → week of Mon 06-08, next week Mon 06-15.
    expect(periodBoundsStr("week", "2026-06-10")).toEqual({
      startStr: "2026-06-08",
      nextStr: "2026-06-15",
    });
  });
  it("month → 1st of the month and 1st of the next month", () => {
    expect(periodBoundsStr("month", "2026-06-15")).toEqual({
      startStr: "2026-06-01",
      nextStr: "2026-07-01",
    });
  });
  it("month → wraps December into the next year", () => {
    expect(periodBoundsStr("month", "2026-12-20")).toEqual({
      startStr: "2026-12-01",
      nextStr: "2027-01-01",
    });
  });
});

describe("periodRange / endOfPeriod (UTC)", () => {
  const TZ = "UTC";
  const tue = new Date("2026-06-09T00:00:00Z"); // a Tuesday

  it("day → [start of the day, start of the next day) as UTC instants", () => {
    const { start, end } = periodRange(tue, "day", TZ);
    expect(iso(start)).toBe("2026-06-09T00:00:00.000Z");
    expect(iso(end)).toBe("2026-06-10T00:00:00.000Z");
    expect(iso(endOfPeriod(tue, "day", TZ))).toBe("2026-06-10T00:00:00.000Z");
  });

  it("week → [Monday, next Monday)", () => {
    const { start, end } = periodRange(tue, "week", TZ);
    expect(iso(start)).toBe("2026-06-08T00:00:00.000Z");
    expect(iso(end)).toBe("2026-06-15T00:00:00.000Z");
  });

  it("month → [1st, 1st of next month)", () => {
    const { start, end } = periodRange(tue, "month", TZ);
    expect(iso(start)).toBe("2026-06-01T00:00:00.000Z");
    expect(iso(end)).toBe("2026-07-01T00:00:00.000Z");
  });
});

describe("periodRange — non-UTC timezone localizes the anchor", () => {
  it("day in America/New_York: a UTC instant maps to the local calendar day", () => {
    // 2026-06-09T02:00:00Z is 2026-06-08 22:00 in New York (UTC-4 in June), so
    // the day period is the local 06-08 → [06-08 04:00Z, 06-09 04:00Z).
    const anchor = new Date("2026-06-09T02:00:00Z");
    const { start, end } = periodRange(anchor, "day", "America/New_York");
    expect(iso(start)).toBe("2026-06-08T04:00:00.000Z");
    expect(iso(end)).toBe("2026-06-09T04:00:00.000Z");
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
