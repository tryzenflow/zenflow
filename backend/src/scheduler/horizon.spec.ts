import {
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

describe("sumWorkMinutes", () => {
  it("counts only work days in the range", () => {
    // Mon–Sun, 8h workday (480 min), Mon–Fri → 5 × 480 = 2400.
    expect(
      sumWorkMinutes("2026-06-08", "2026-06-14", 540, 1020, [1, 2, 3, 4, 5]),
    ).toBe(2400);
  });
});
