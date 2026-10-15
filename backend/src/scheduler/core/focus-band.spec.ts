import { FOCUS_BANDS, PREFERENCE_MATRIX_LENGTH } from "@zenflow/shared";
import {
  FOCUS_BAND_HIGH,
  FOCUS_BAND_LOW,
  focusBandHours,
  focusBandPrior,
  isDefaultPreferenceMatrix,
  seedFocusBandMatrix,
} from "./focus-band";
import { defaultPreferenceMatrix, matrixIndex } from "./preference";

describe("focusBandPrior", () => {
  it.each(FOCUS_BANDS)(
    "%s is high in its hours on every weekday and low elsewhere",
    (band) => {
      const prior = focusBandPrior(band);
      const hours = new Set(focusBandHours(band));
      expect(prior).toHaveLength(PREFERENCE_MATRIX_LENGTH);
      for (let wd = 1; wd <= 7; wd++) {
        for (let hour = 0; hour < 24; hour++) {
          const expected = hours.has(hour) ? FOCUS_BAND_HIGH : FOCUS_BAND_LOW;
          expect(prior[matrixIndex(wd, hour)]).toBe(expected);
        }
      }
    },
  );

  it("is strictly higher inside the band than outside it", () => {
    expect(FOCUS_BAND_HIGH).toBeGreaterThan(FOCUS_BAND_LOW);
    expect(FOCUS_BAND_LOW).toBeGreaterThan(0);
  });

  it("gives LATE_NIGHT the hours either side of midnight", () => {
    const prior = focusBandPrior("LATE_NIGHT");
    expect(prior[matrixIndex(3, 23)]).toBe(FOCUS_BAND_HIGH);
    expect(prior[matrixIndex(3, 0)]).toBe(FOCUS_BAND_HIGH);
    expect(prior[matrixIndex(3, 1)]).toBe(FOCUS_BAND_HIGH);
    expect(prior[matrixIndex(3, 2)]).toBe(FOCUS_BAND_LOW);
    expect(prior[matrixIndex(3, 20)]).toBe(FOCUS_BAND_LOW);
  });

  it("keeps the bands disjoint", () => {
    const seen = new Set<number>();
    for (const band of FOCUS_BANDS) {
      for (const hour of focusBandHours(band)) {
        expect(seen.has(hour)).toBe(false);
        seen.add(hour);
      }
    }
  });

  it("returns a fresh array on each call", () => {
    const a = focusBandPrior("MORNING");
    a[0] = 99;
    expect(focusBandPrior("MORNING")[0]).toBe(FOCUS_BAND_LOW);
  });
});

describe("isDefaultPreferenceMatrix", () => {
  it("treats an empty or wrong-length matrix as default", () => {
    expect(isDefaultPreferenceMatrix([])).toBe(true);
    expect(isDefaultPreferenceMatrix([1, 0.5])).toBe(true);
  });

  it("treats the cold-start population as default", () => {
    expect(isDefaultPreferenceMatrix(defaultPreferenceMatrix())).toBe(true);
  });

  it("treats any learned or seeded value as not default", () => {
    const learned = defaultPreferenceMatrix();
    learned[matrixIndex(2, 10)] = 0.9;
    expect(isDefaultPreferenceMatrix(learned)).toBe(false);
    expect(isDefaultPreferenceMatrix(focusBandPrior("EVENING"))).toBe(false);
  });
});

describe("seedFocusBandMatrix", () => {
  it("seeds an empty matrix with the band prior", () => {
    expect(seedFocusBandMatrix([], "AFTERNOON")).toEqual(
      focusBandPrior("AFTERNOON"),
    );
  });

  it("seeds a matrix still at the cold-start default", () => {
    expect(seedFocusBandMatrix(defaultPreferenceMatrix(), "MORNING")).toEqual(
      focusBandPrior("MORNING"),
    );
  });

  it("returns null for a learned matrix so it is not overwritten", () => {
    const learned = defaultPreferenceMatrix();
    learned[matrixIndex(5, 18)] = -0.4;
    expect(seedFocusBandMatrix(learned, "EVENING")).toBeNull();
  });

  it("returns null for a previously seeded matrix", () => {
    expect(
      seedFocusBandMatrix(focusBandPrior("MORNING"), "LATE_NIGHT"),
    ).toBeNull();
  });
});
