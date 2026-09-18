import {
  defaultPreferenceMatrix,
  effectivePreferenceMatrix,
  matrixIndex,
  reinforcePreferenceCell,
} from "./preference";
import { PREFERENCE_LEARNING_RATE } from "../constants";

describe("matrixIndex", () => {
  it("is row-major by ISO weekday over 24 one-hour buckets", () => {
    expect(matrixIndex(1, 0)).toBe(0); // Monday 00:00
    expect(matrixIndex(1, 23)).toBe(23); // Monday 23:00
    expect(matrixIndex(2, 0)).toBe(24); // Tuesday 00:00
    expect(matrixIndex(7, 23)).toBe(167); // Sunday 23:00 — last cell
  });
});

describe("default preference-matrix fallback", () => {
  it("is used whenever the stored matrix length doesn't match PREFERENCE_MATRIX_LENGTH", () => {
    expect(effectivePreferenceMatrix([])).toEqual(defaultPreferenceMatrix());
    expect(effectivePreferenceMatrix([0.5])).toEqual(defaultPreferenceMatrix());
  });

  it("is NOT used when the stored matrix is well-formed (168 cells), even if all zero", () => {
    const zeroed = new Array<number>(168).fill(0);
    expect(effectivePreferenceMatrix(zeroed)).toBe(zeroed);
  });

  it("populates morning (8-11AM)=1, afternoon (2-5PM)=0.5, evening (7-10PM)=0.2, rest=0", () => {
    // NOTE: the JSDoc on `defaultPreferenceMatrix` describes the evening
    // window as "6-10PM", but the implementation's loop is `for (let hour =
    // 19; hour < 22; ...)`, i.e. hours 19-21 (7-10PM), not 18-21. That
    // doc/code mismatch is pre-existing — this test asserts the actual
    // runtime behavior.
    const matrix = defaultPreferenceMatrix();
    for (let wd = 1; wd <= 7; wd++) {
      expect(matrix[matrixIndex(wd, 8)]).toBe(1);
      expect(matrix[matrixIndex(wd, 9)]).toBe(1);
      expect(matrix[matrixIndex(wd, 10)]).toBe(1);
      expect(matrix[matrixIndex(wd, 11)]).toBe(0); // just past the morning window

      expect(matrix[matrixIndex(wd, 14)]).toBe(0.5);
      expect(matrix[matrixIndex(wd, 16)]).toBe(0.5);
      expect(matrix[matrixIndex(wd, 17)]).toBe(0); // just past the afternoon window

      expect(matrix[matrixIndex(wd, 18)]).toBe(0); // just before the evening window
      expect(matrix[matrixIndex(wd, 19)]).toBe(0.2);
      expect(matrix[matrixIndex(wd, 21)]).toBe(0.2);
      expect(matrix[matrixIndex(wd, 22)]).toBe(0); // just past the evening window

      expect(matrix[matrixIndex(wd, 0)]).toBe(0);
      expect(matrix[matrixIndex(wd, 12)]).toBe(0);
    }
    expect(matrix).toHaveLength(168);
  });
});

describe("reinforcePreferenceCell", () => {
  const TZ = "UTC";
  const ZERO = new Array<number>(168).fill(0);
  const MON_09 = new Date("2026-06-15T09:30:00.000Z").getTime(); // Monday 09:xx UTC

  it("nudges only the ONE hour bucket containing atMs, by +rate·delta", () => {
    const idx = matrixIndex(1, 9); // Monday, hour 9
    const next = reinforcePreferenceCell(ZERO, MON_09, TZ, 1);
    expect(next[idx]).toBeCloseTo(PREFERENCE_LEARNING_RATE);
    // every other cell is untouched
    next.forEach((cell, i) => {
      if (i !== idx) expect(cell).toBe(0);
    });
  });

  it("delta = -1 moves the cell down instead of up", () => {
    const idx = matrixIndex(1, 9);
    const next = reinforcePreferenceCell(ZERO, MON_09, TZ, -1);
    expect(next[idx]).toBeCloseTo(-PREFERENCE_LEARNING_RATE);
  });

  it("clamps to [-1, 1] — ten consecutive same-direction events converge to the ceiling, never past it", () => {
    let matrix = ZERO;
    for (let i = 0; i < 10; i++) {
      matrix = reinforcePreferenceCell(matrix, MON_09, TZ, 1);
    }
    const idx = matrixIndex(1, 9);
    expect(matrix[idx]).toBeCloseTo(1);

    // an 11th event doesn't push it past the ceiling.
    matrix = reinforcePreferenceCell(matrix, MON_09, TZ, 1);
    expect(matrix[idx]).toBe(1);
  });

  it("accumulates additively on top of an existing non-zero cell value", () => {
    const idx = matrixIndex(1, 9);
    const seeded = [...ZERO];
    seeded[idx] = 0.5;
    const next = reinforcePreferenceCell(seeded, MON_09, TZ, 1);
    expect(next[idx]).toBeCloseTo(0.6);
  });

  it("falls back to the cold-start default matrix when the stored matrix is malformed", () => {
    // Monday 05:00 UTC — outside every cold-start default window (0 by
    // default), so the +delta is directly observable on top of it.
    const mon05 = new Date("2026-06-15T05:30:00.000Z").getTime();
    const idx = matrixIndex(1, 5);
    expect(defaultPreferenceMatrix()[idx]).toBe(0);
    const next = reinforcePreferenceCell([], mon05, TZ, 1);
    expect(next[idx]).toBeCloseTo(
      defaultPreferenceMatrix()[idx] + PREFERENCE_LEARNING_RATE,
    );
  });

  it("does not mutate the input matrix", () => {
    const original = [...ZERO];
    reinforcePreferenceCell(original, MON_09, TZ, 1);
    expect(original).toEqual(ZERO);
  });

  it("respects a custom rate override", () => {
    const idx = matrixIndex(1, 9);
    const next = reinforcePreferenceCell(ZERO, MON_09, TZ, 1, 0.25);
    expect(next[idx]).toBeCloseTo(0.25);
  });
});
