import {
  PREFERENCE_MATRIX_LENGTH,
  PREFERENCE_SLOTS_PER_DAY,
} from "@zenflow/shared";
import { clamp, utcToMinutes } from "../../common/utils";
import { PREFERENCE_LEARNING_RATE } from "../constants";
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

/**
 * One additive reinforcement step for a single hour-bucket cell (Item 3B3):
 *
 *   matrix[idx] = clamp(matrix[idx] + PREFERENCE_LEARNING_RATE · delta, -1, 1)
 *
 * `delta` is `+1` for a kept placement (`RETAINED`), `-1` for a first move
 * away from one (`MOVE`) — never the raw drag-distance-graded reward; B3
 * reinforces the MATRIX (a coarse per-hour like/dislike signal shared by
 * both policies), not LinUCB's own graded reward (that's `dragDistanceReward`,
 * unrelated). At `η = 0.1` (the existing `PREFERENCE_LEARNING_RATE`), ten
 * consecutive same-direction events on one bucket converge to the ±1
 * ceiling — matching the constant's own doc comment. Only `idx`, the ONE
 * hour bucket containing `atMs`'s local start instant, is touched — not an
 * overlap-weighted spread across every hour a session's duration touches
 * (`slotPreferenceScore`'s convention for SCORING an extended interval).
 * Reinforcement credits a single concrete decision point (the hour a user
 * did or didn't reject), so it reuses `preferenceScoreAt`'s existing
 * single-hour-bucket indexing convention instead.
 *
 * Returns a NEW array (matrix is not mutated) — same convention as
 * `decayMatrix`.
 */
export function reinforcePreferenceCell(
  matrix: number[],
  atMs: number,
  timezone: string,
  delta: 1 | -1,
  rate: number = PREFERENCE_LEARNING_RATE,
): number[] {
  const effective = effectivePreferenceMatrix(matrix);
  const idx = matrixIndex(
    isoWeekday(localDateStr(new Date(atMs), timezone)),
    Math.floor(utcToMinutes(new Date(atMs), timezone) / 60),
  );
  const next = [...effective];
  next[idx] = clamp(next[idx] + rate * delta, -1, 1);
  return next;
}
