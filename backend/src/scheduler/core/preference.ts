import {
  PREFERENCE_MATRIX_LENGTH,
  PREFERENCE_SLOTS_PER_DAY,
} from "@zenflow/shared";
import { clamp, utcToMinutes } from "../../common/utils";
import { PREFERENCE_LEARNING_RATE } from "../constants";
import { dragDistanceReward } from "./reward";
import { isoWeekday, localDateStr } from "./slot";

/**
 * Preference-matrix helpers — pure, no I/O, no clock, no randomness
 * (CLAUDE.md invariant 2). The matrix is a flat **168** signed floats:
 * 7 ISO weekdays × 24 one-hour buckets, row-major by weekday
 * (`@zenflow/shared`'s `PREFERENCE_MATRIX_LENGTH` / `PREFERENCE_SLOTS_PER_DAY`).
 * Slot scoring built on these lives in `slot-score.ts`.
 */

/**
 * Flat-array index into the 7×24 signed preference matrix, 7 ISO weekdays
 * (Mon = 1 … Sun = 7) × 24 one-hour buckets, row-major by weekday.
 */
export function matrixIndex(isoWeekdayNum: number, hour: number): number {
  return (isoWeekdayNum - 1) * PREFERENCE_SLOTS_PER_DAY + hour;
}

/**
 * Cold-start default population, used whenever a user's stored
 * `preferenceMatrix` is empty/unset (length !== {@link PREFERENCE_MATRIX_LENGTH}):
 * morning 8–11AM → 1 (high), afternoon 2–5PM → 0.5 (medium), evening 7–10PM →
 * 0.2 (low), everything else → 0 (neutral, never negative).
 */
export function defaultPreferenceMatrix(): number[] {
  const matrix = new Array<number>(PREFERENCE_MATRIX_LENGTH).fill(0);
  for (let wd = 1; wd <= 7; wd++) {
    for (let hour = 8; hour < 11; hour++) matrix[matrixIndex(wd, hour)] = 1;
    for (let hour = 14; hour < 17; hour++) matrix[matrixIndex(wd, hour)] = 0.5;
    for (let hour = 19; hour < 22; hour++) matrix[matrixIndex(wd, hour)] = 0.2;
  }
  return matrix;
}

/** The stored matrix if well-formed, else the {@link defaultPreferenceMatrix} fallback. */
export function effectivePreferenceMatrix(prefMatrix: number[]): number[] {
  return prefMatrix.length === PREFERENCE_MATRIX_LENGTH
    ? prefMatrix
    : defaultPreferenceMatrix();
}

/** Preference-matrix value of the hour bucket `instant` falls in, in `timezone`. */
export function preferenceScoreAt(
  matrix: number[],
  instant: Date,
  timezone: string,
): number {
  const dateStr = localDateStr(instant, timezone);
  const wd = isoWeekday(dateStr);
  const hour = Math.floor(utcToMinutes(instant, timezone) / 60);
  return matrix[matrixIndex(wd, hour)] ?? 0;
}

/** Flat matrix index of the local hour bucket containing `atMs`. */
function cellIndexAt(atMs: number, timezone: string): number {
  return matrixIndex(
    isoWeekday(localDateStr(new Date(atMs), timezone)),
    Math.floor(utcToMinutes(new Date(atMs), timezone) / 60),
  );
}

/**
 * Nudges the ONE hour bucket containing `atMs` by `PREFERENCE_LEARNING_RATE ·
 * delta` (`delta` in `[-1, 1]`), clamped to `[-1, 1]`. Returns a NEW array.
 */
export function reinforcePreferenceCell(
  matrix: number[],
  atMs: number,
  timezone: string,
  delta: number,
  rate: number = PREFERENCE_LEARNING_RATE,
): number[] {
  const next = [...effectivePreferenceMatrix(matrix)];
  const idx = cellIndexAt(atMs, timezone);
  next[idx] = clamp(next[idx] + rate * delta, -1, 1);
  return next;
}

/**
 * First move of a placed session: lowers the old hour and raises the new hour
 * by `η·g`, `g = -dragDistanceReward(drag)` in `[0, 1]`. No-op for a zero-distance
 * move or one inside a single hour bucket. Returns a NEW array.
 */
export function reinforcePreferenceMove(
  matrix: number[],
  oldStartMs: number,
  newStartMs: number,
  timezone: string,
  dragDistanceMinutes: number,
  rate: number = PREFERENCE_LEARNING_RATE,
): number[] {
  const grade = -dragDistanceReward(dragDistanceMinutes);
  const sameCell =
    cellIndexAt(oldStartMs, timezone) === cellIndexAt(newStartMs, timezone);
  if (grade === 0 || sameCell) return [...effectivePreferenceMatrix(matrix)];

  const lowered = reinforcePreferenceCell(
    matrix,
    oldStartMs,
    timezone,
    -grade,
    rate,
  );
  return reinforcePreferenceCell(lowered, newStartMs, timezone, grade, rate);
}
