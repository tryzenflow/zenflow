import { periodsToWallClock } from "./period-map";

const hm = (h: number, m: number) => h * 60 + m;

describe("periodsToWallClock — documented blocks", () => {
  it("periods 1–4 span 07:30–11:10 (220 raw minutes, incl. the 20-min break)", () => {
    // The real captured timetable row: PeriodID 1, NumberOfPeriods 4.
    const span = periodsToWallClock(1, 4);
    expect(span).toEqual({ startMin: hm(7, 30), endMin: hm(11, 10) });
    expect(span!.endMin - span!.startMin).toBe(220);
  });

  it("periods 7–10 span 13:00–16:30 (210 raw minutes, incl. the 10-min break)", () => {
    const span = periodsToWallClock(7, 4);
    expect(span).toEqual({ startMin: hm(13, 0), endMin: hm(16, 30) });
    expect(span!.endMin - span!.startMin).toBe(210);
  });

  it("periods 11–14 span 16:40–20:00 (200 raw minutes, no break)", () => {
    const span = periodsToWallClock(11, 4);
    expect(span).toEqual({ startMin: hm(16, 40), endMin: hm(20, 0) });
    expect(span!.endMin - span!.startMin).toBe(200);
  });
});

describe("periodsToWallClock — single periods and partial spans", () => {
  it("a single period is 50 minutes", () => {
    expect(periodsToWallClock(1, 1)).toEqual({
      startMin: hm(7, 30),
      endMin: hm(8, 20),
    });
    expect(periodsToWallClock(14, 1)).toEqual({
      startMin: hm(19, 10),
      endMin: hm(20, 0),
    });
  });

  it("periods 3–4 start after the morning break", () => {
    expect(periodsToWallClock(3, 2)).toEqual({
      startMin: hm(9, 30),
      endMin: hm(11, 10),
    });
  });

  it("periods 9–10 start after the afternoon break", () => {
    expect(periodsToWallClock(9, 2)).toEqual({
      startMin: hm(14, 50),
      endMin: hm(16, 30),
    });
  });

  it("includes an intervening break when the span crosses it", () => {
    // 1–2 is unbroken (100 min); 1–3 swallows the 20-minute break (170 min).
    expect(periodsToWallClock(1, 2)!.endMin - hm(7, 30)).toBe(100);
    expect(periodsToWallClock(1, 3)!.endMin - hm(7, 30)).toBe(170);
  });

  it("allows a span across the 16:30–16:40 block gap", () => {
    expect(periodsToWallClock(10, 2)).toEqual({
      startMin: hm(15, 40),
      endMin: hm(17, 30),
    });
  });
});

describe("periodsToWallClock — unmapped input yields null", () => {
  it("returns null for the undocumented periods 5 and 6", () => {
    expect(periodsToWallClock(5, 1)).toBeNull();
    expect(periodsToWallClock(6, 2)).toBeNull();
  });

  it("returns null for a span that reaches over periods 5–6", () => {
    // Both ends are known, but 5 and 6 in the middle are not — the span must
    // not silently become 10:20 → 13:50.
    expect(periodsToWallClock(4, 4)).toBeNull();
    expect(periodsToWallClock(4, 3)).toBeNull();
  });

  it("returns null past the end of the day and before the first period", () => {
    expect(periodsToWallClock(14, 2)).toBeNull();
    expect(periodsToWallClock(15, 1)).toBeNull();
    expect(periodsToWallClock(0, 1)).toBeNull();
  });

  it("returns null for a non-positive or non-integer count", () => {
    expect(periodsToWallClock(1, 0)).toBeNull();
    expect(periodsToWallClock(1, -2)).toBeNull();
    expect(periodsToWallClock(1.5, 1)).toBeNull();
    expect(periodsToWallClock(1, 1.5)).toBeNull();
    expect(periodsToWallClock(NaN, 1)).toBeNull();
  });
});
