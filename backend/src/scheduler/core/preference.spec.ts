import {
  defaultPreferenceMatrix,
  effectivePreferenceMatrix,
  matrixIndex,
} from "./preference";

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
