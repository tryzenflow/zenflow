import { armOfMinute, ARM_BANDS, overlapRate } from "./arms";

describe("armOfMinute", () => {
  it("maps band boundaries half-open, lower-inclusive", () => {
    expect(armOfMinute(0)).toBe("EARLY_MORNING");
    expect(armOfMinute(359)).toBe("EARLY_MORNING");
    expect(armOfMinute(360)).toBe("MORNING");
    expect(armOfMinute(659)).toBe("MORNING");
    expect(armOfMinute(660)).toBe("AFTERNOON");
    expect(armOfMinute(1019)).toBe("AFTERNOON");
    // 17:00 → EVENING (the canonical boundary example).
    expect(armOfMinute(17 * 60)).toBe("EVENING");
    expect(armOfMinute(1199)).toBe("EVENING");
    expect(armOfMinute(1200)).toBe("NIGHT");
    expect(armOfMinute(1439)).toBe("NIGHT");
  });

  it("wraps out-of-range minutes into [0, 1440)", () => {
    expect(armOfMinute(1440)).toBe("EARLY_MORNING");
    expect(armOfMinute(-15)).toBe("NIGHT");
  });

  it("bands tile [0, 1440) with no gap or overlap", () => {
    expect(ARM_BANDS[0].start).toBe(0);
    expect(ARM_BANDS[ARM_BANDS.length - 1].end).toBe(1440);
    for (let i = 1; i < ARM_BANDS.length; i++) {
      expect(ARM_BANDS[i].start).toBe(ARM_BANDS[i - 1].end);
    }
  });
});

describe("overlapRate", () => {
  const TZ = "UTC";
  const at = (iso: string) => new Date(iso).getTime();

  it("splits a 19:00–21:00 slot 0.5 EVENING / 0.5 NIGHT", () => {
    const start = at("2026-06-15T19:00:00.000Z");
    const end = at("2026-06-15T21:00:00.000Z");
    expect(overlapRate(start, end, "EVENING", TZ)).toBeCloseTo(0.5);
    expect(overlapRate(start, end, "NIGHT", TZ)).toBeCloseTo(0.5);
    expect(overlapRate(start, end, "AFTERNOON", TZ)).toBe(0);
  });

  it("a slot fully inside AFTERNOON is 1.0 there and 0 elsewhere", () => {
    const start = at("2026-06-15T13:00:00.000Z");
    const end = at("2026-06-15T14:30:00.000Z");
    expect(overlapRate(start, end, "AFTERNOON", TZ)).toBe(1);
    expect(overlapRate(start, end, "MORNING", TZ)).toBe(0);
    expect(overlapRate(start, end, "EVENING", TZ)).toBe(0);
  });

  it("a 17:00 start counts toward EVENING", () => {
    const start = at("2026-06-15T17:00:00.000Z");
    const end = at("2026-06-15T18:00:00.000Z");
    expect(overlapRate(start, end, "EVENING", TZ)).toBe(1);
  });

  it("honours the timezone wall clock", () => {
    // 12:00Z is 19:00 in Asia/Saigon (UTC+7) → EVENING.
    const start = at("2026-06-15T12:00:00.000Z");
    const end = at("2026-06-15T13:00:00.000Z");
    expect(overlapRate(start, end, "EVENING", "Asia/Saigon")).toBe(1);
    expect(overlapRate(start, end, "AFTERNOON", "Asia/Saigon")).toBe(0);
  });

  it("splits a slot that spans local midnight across both days' bands (D5)", () => {
    // 23:00–01:00 → 1h in NIGHT (23:00–24:00) + 1h in EARLY_MORNING
    // (00:00–01:00), each 0.5 of the 2h slot.
    const start = at("2026-06-15T23:00:00.000Z");
    const end = at("2026-06-16T01:00:00.000Z");
    expect(overlapRate(start, end, "NIGHT", TZ)).toBeCloseTo(0.5);
    expect(overlapRate(start, end, "EARLY_MORNING", TZ)).toBeCloseTo(0.5);
    expect(overlapRate(start, end, "EVENING", TZ)).toBe(0);
  });

  it("returns 0 for a non-positive interval", () => {
    const t = at("2026-06-15T13:00:00.000Z");
    expect(overlapRate(t, t, "AFTERNOON", TZ)).toBe(0);
  });
});
