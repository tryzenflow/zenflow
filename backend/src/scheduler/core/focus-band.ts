import { PREFERENCE_MATRIX_LENGTH, type FocusBand } from "@zenflow/shared";
import { defaultPreferenceMatrix, matrixIndex } from "./preference";

/**
 * Onboarding focus-band prior for the 7x24 preference matrix. Pure, no I/O.
 * The band's hours get {@link FOCUS_BAND_HIGH} on every weekday, the rest
 * {@link FOCUS_BAND_LOW}. The writer is `UsersService`, which only seeds a
 * matrix that is still the default.
 */

/** Weight of the chosen band's hours. */
export const FOCUS_BAND_HIGH = 1;
/** Weight of every other hour. Same tier as the default matrix's evening cells. */
export const FOCUS_BAND_LOW = 0.2;

/** Local hours (0 to 23) of each band. LATE_NIGHT wraps past midnight. */
const BAND_HOURS: Record<FocusBand, readonly number[]> = {
  MORNING: [8, 9, 10, 11],
  AFTERNOON: [12, 13, 14, 15, 16],
  EVENING: [17, 18, 19, 20],
  LATE_NIGHT: [21, 22, 23, 0, 1],
};

/** Hours (0 to 23) of the band, in order from its start. */
export function focusBandHours(band: FocusBand): readonly number[] {
  return BAND_HOURS[band];
}

/** The 168-element prior for a band: {@link FOCUS_BAND_HIGH} in its hours, {@link FOCUS_BAND_LOW} elsewhere, every weekday. */
export function focusBandPrior(band: FocusBand): number[] {
  const inBand = new Set(BAND_HOURS[band]);
  const matrix = new Array<number>(PREFERENCE_MATRIX_LENGTH).fill(
    FOCUS_BAND_LOW,
  );
  for (let wd = 1; wd <= 7; wd++) {
    for (const hour of inBand) {
      matrix[matrixIndex(wd, hour)] = FOCUS_BAND_HIGH;
    }
  }
  return matrix;
}

/**
 * True when the stored matrix holds no learned or seeded data: empty (the column
 * default), wrong length, or exactly the cold-start default population.
 */
export function isDefaultPreferenceMatrix(matrix: readonly number[]): boolean {
  if (matrix.length !== PREFERENCE_MATRIX_LENGTH) return true;
  const defaults = defaultPreferenceMatrix();
  return matrix.every((value, i) => value === defaults[i]);
}

/**
 * The matrix to store after a focus-band answer, or `null` when the current
 * matrix already holds learned or seeded data and must stay as it is.
 */
export function seedFocusBandMatrix(
  current: readonly number[],
  band: FocusBand,
): number[] | null {
  return isDefaultPreferenceMatrix(current) ? focusBandPrior(band) : null;
}
