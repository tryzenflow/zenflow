import { MATRIX_HALF_LIFE_DAYS, decayMatrix } from "./matrix-decay";

/**
 * Pure exponential matrix decay (ADR-0001 §3). The decay math is `cell *=
 * 2^(−Δdays/halfLife)`; the constant is configurable; the input is never
 * mutated; and decay never amplifies.
 */

describe("MATRIX_HALF_LIFE_DAYS", () => {
  it("is the documented 21-day (~3-week) half-life", () => {
    expect(MATRIX_HALF_LIFE_DAYS).toBe(21);
  });
});

describe("decayMatrix — cell *= 2^(−Δdays / halfLifeDays)", () => {
  it("halves every cell after exactly one half-life", () => {
    const out = decayMatrix(
      [8, -4, 0, 1],
      MATRIX_HALF_LIFE_DAYS,
      MATRIX_HALF_LIFE_DAYS,
    );
    expect(out[0]).toBeCloseTo(4);
    expect(out[1]).toBeCloseTo(-2);
    expect(out[2]).toBeCloseTo(0);
    expect(out[3]).toBeCloseTo(0.5);
  });

  it("quarters a cell after two half-lives", () => {
    const out = decayMatrix(
      [8],
      2 * MATRIX_HALF_LIFE_DAYS,
      MATRIX_HALF_LIFE_DAYS,
    );
    expect(out[0]).toBeCloseTo(2);
  });

  it("preserves sign and only shrinks magnitude toward 0", () => {
    const out = decayMatrix([10, -10], 7, 21);
    expect(out[0]).toBeGreaterThan(0);
    expect(out[0]).toBeLessThan(10);
    expect(out[1]).toBeLessThan(0);
    expect(out[1]).toBeGreaterThan(-10);
    expect(out[0]).toBeCloseTo(-out[1]); // symmetric magnitude
  });

  it("defaults to MATRIX_HALF_LIFE_DAYS when the half-life arg is omitted", () => {
    const a = decayMatrix([16], MATRIX_HALF_LIFE_DAYS);
    const b = decayMatrix([16], MATRIX_HALF_LIFE_DAYS, MATRIX_HALF_LIFE_DAYS);
    expect(a).toEqual(b);
    expect(a[0]).toBeCloseTo(8);
  });

  it("accepts a configurable half-life (drift-sensitivity sweep)", () => {
    // A 7-day half-life decays 7 days to exactly one half.
    expect(decayMatrix([4], 7, 7)[0]).toBeCloseTo(2);
  });

  it("never mutates the input array", () => {
    const input = [8, -4];
    const out = decayMatrix(input, 21, 21);
    expect(input).toEqual([8, -4]);
    expect(out).not.toBe(input);
  });

  it("is a no-op copy for non-positive deltaDays (no amplification)", () => {
    expect(decayMatrix([8, -4], 0)).toEqual([8, -4]);
    expect(decayMatrix([8, -4], -5)).toEqual([8, -4]);
  });

  it("treats a non-positive half-life as no decay (guard against misconfig)", () => {
    expect(decayMatrix([8, -4], 10, 0)).toEqual([8, -4]);
    expect(decayMatrix([8, -4], 10, -1)).toEqual([8, -4]);
  });

  it("handles an empty matrix", () => {
    expect(decayMatrix([], 10, 21)).toEqual([]);
  });
});
