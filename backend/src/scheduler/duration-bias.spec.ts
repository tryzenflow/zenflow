import {
  NEUTRAL_BIAS,
  blendBias,
  correctDuration,
  maxBias,
  type TagBias,
} from "./duration-bias";

/**
 * Pure per-tag duration-bias blend + correction (ADR-0001 §2). Covers the
 * sample-weighted blend (default), the max-bias ablation knob (opt-in), and the
 * ceil-to-15 correction that preserves the grid invariant (#3).
 */

describe("blendBias — sample-weighted Σ(nₜ·bₜ)/Σ(nₜ)", () => {
  it("returns the multiplier when a single tag carries all the evidence", () => {
    expect(blendBias([{ n: 10, b: 1.3 }])).toBeCloseTo(1.3);
  });

  it("weights a well-evidenced tag over a one-sample fluke", () => {
    // #admin (n=20, 1.5) vs #finance (n=1, 0.5):
    //   (20*1.5 + 1*0.5) / 21 = 30.5 / 21 ≈ 1.452 — close to the evidenced 1.5.
    expect(
      blendBias([
        { n: 20, b: 1.5 },
        { n: 1, b: 0.5 },
      ]),
    ).toBeCloseTo(30.5 / 21);
  });

  it("ignores tags with no evidence (n <= 0)", () => {
    const perTag: TagBias[] = [
      { n: 8, b: 1.2 },
      { n: 0, b: 99 },
      { n: -3, b: -99 },
    ];
    expect(blendBias(perTag)).toBeCloseTo(1.2);
  });

  it("returns NEUTRAL_BIAS (1.0) for an empty or evidence-free table", () => {
    expect(blendBias([])).toBe(NEUTRAL_BIAS);
    expect(blendBias([{ n: 0, b: 2 }])).toBe(NEUTRAL_BIAS);
  });
});

describe("maxBias — opt-in ablation knob (largest multiplier)", () => {
  it("takes the single largest evidenced multiplier", () => {
    expect(
      maxBias([
        { n: 5, b: 1.1 },
        { n: 2, b: 1.8 },
        { n: 9, b: 1.4 },
      ]),
    ).toBeCloseTo(1.8);
  });

  it("over-reserves vs the blend on a mixed multi-tag task (why it is not default)", () => {
    const perTag: TagBias[] = [
      { n: 30, b: 1.0 },
      { n: 2, b: 2.0 },
    ];
    // blend ≈ (30 + 4)/32 = 1.0625, max = 2.0 — max inflates the schedule.
    expect(blendBias(perTag)).toBeLessThan(maxBias(perTag));
    expect(maxBias(perTag)).toBeCloseTo(2.0);
  });

  it("ignores evidence-free tags and falls back to NEUTRAL_BIAS when empty", () => {
    expect(maxBias([{ n: 0, b: 5 }])).toBe(NEUTRAL_BIAS);
    expect(maxBias([])).toBe(NEUTRAL_BIAS);
  });
});

describe("correctDuration — estimated × bias, ceil to next 15-min", () => {
  it("rounds the corrected duration UP to the next 15-min multiple", () => {
    // 60 * 1.3 = 78 → ceil to 90.
    expect(correctDuration(60, 1.3)).toBe(90);
    // 30 * 1.1 = 33 → ceil to 45.
    expect(correctDuration(30, 1.1)).toBe(45);
  });

  it("leaves an exact-grid result unchanged", () => {
    // 60 * 1.5 = 90, already a multiple of 15.
    expect(correctDuration(60, 1.5)).toBe(90);
    // neutral bias on a grid value is a no-op.
    expect(correctDuration(45, NEUTRAL_BIAS)).toBe(45);
  });

  it("never returns below one 15-min slot", () => {
    // 15 * 0.1 = 1.5 → ceil 15 (the floor), never 0.
    expect(correctDuration(15, 0.1)).toBe(15);
  });

  it("treats a non-finite or non-positive bias as neutral (no correction)", () => {
    expect(correctDuration(60, Number.NaN)).toBe(60);
    expect(correctDuration(60, 0)).toBe(60);
    expect(correctDuration(60, -2)).toBe(60);
    expect(correctDuration(60, Infinity)).toBe(60);
  });

  it("always returns a positive multiple of 15", () => {
    for (const est of [15, 30, 45, 90, 120]) {
      for (const bias of [0.7, 1.0, 1.23, 1.9, 2.4]) {
        const out = correctDuration(est, bias);
        expect(out % 15).toBe(0);
        expect(out).toBeGreaterThanOrEqual(15);
      }
    }
  });
});
