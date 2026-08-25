import {
  PREFERENCE_MATRIX_LENGTH,
  PREFERENCE_SLOTS_PER_DAY,
} from "@zenflow/shared";
import { utcToMinutes } from "../common/utils";
import {
  ceilToSlot,
  floorToSlot,
  Interval,
  isoWeekday,
  localDateStr,
  MS_PER_MINUTE,
  overlapsAny,
  SLOT_MS,
} from "./utils/slot";
import { differenceInMinutes } from "date-fns";

/**
 * Simple deterministic rank + best-fit-by-preference scheduler
 * (`docs/heuristic.md`). No I/O, clock, or randomness — `now` is always
 * injected — same discipline as `slot.ts`/`horizon.ts`. This replaces the
 * deleted EDF/softmax engine (commit 6d3f42b): fully deterministic, no
 * seeded PRNG, no cost-blend.
 */

export interface HeuristicSession {
  id: string;
  durationMinutes: number;
  deadline: Date;
  scheduledStartTime: Date | null; // used only for tie-break scoring
}

export interface Placement {
  id: string;
  scheduledStartTime: Date;
}

/**
 * Flat-array index into the 7×24 signed preference matrix
 * (`packages/shared/src/view.ts`'s `PREFERENCE_MATRIX_LENGTH`), 7 ISO
 * weekdays × 24 one-hour buckets, row-major by weekday.
 */
export function matrixIndex(isoWeekdayNum: number, hour: number): number {
  return (isoWeekdayNum - 1) * PREFERENCE_SLOTS_PER_DAY + hour;
}

/**
 * notes.md's cold-start default population, used whenever a user's stored
 * `preferenceMatrix` is empty/unset (length !== {@link PREFERENCE_MATRIX_LENGTH}):
 * morning 8–11AM → 1 (high), afternoon 2–5PM → 0.5 (medium), evening 6–10PM →
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

/** Preference-matrix score of the hour bucket `instant` falls in, in `timezone`. */
function preferenceScoreAt(
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
 * Sort sessions by urgency (ascending days-from-now-to-deadline; no deadline
 * sorts last), ties broken by `id` for determinism.
 */
export function sortEDF(
  sessions: HeuristicSession[],
  now: Date,
): HeuristicSession[] {
  return [...sessions].sort((a, b) => {
    const minutesA = differenceInMinutes(a.deadline, now);
    const minutesB = differenceInMinutes(b.deadline, now);
    if (minutesA !== minutesB) return minutesA - minutesB;

    return a.id.localeCompare(b.id);
  });
}

/**
 * Scan every 15-minute-aligned candidate start in `[windowStart, windowEnd)`
 * and return the free one (no overlap with `occupied`, fits before
 * `windowEnd`) whose start-hour has the highest preference score. Earliest
 * start wins ties. `null` when nothing free fits.
 */
function bestFreeSlot(
  durationMinutes: number,
  occupied: Interval[],
  windowStart: Date,
  windowEnd: Date,
  prefMatrix: number[],
  timezone: string,
): Date | null {
  const matrix = effectivePreferenceMatrix(prefMatrix);
  const durationMs = durationMinutes * MS_PER_MINUTE;
  // windowEnd is typically capped to a session's deadline by the caller, and
  // deadlines are arbitrary user-entered instants — not guaranteed to be
  // slot-aligned. Round DOWN so a session is never placed to finish past the
  // exact deadline instant (rounding up here would let it finish up to one
  // slot late, which is an EDF-correctness bug).
  const windowEndMs = floorToSlot(windowEnd.getTime());

  let best: { start: number; score: number } | null = null;
  for (
    let start = ceilToSlot(windowStart.getTime());
    start < windowEndMs;
    start += SLOT_MS
  ) {
    const end = start + durationMs;
    if (end > windowEndMs) continue;
    if (overlapsAny(occupied, start, end)) continue;

    let total = 0;
    // [start, end) is half-open — a session doesn't occupy the instant `end`
    // itself, so the hour bucket starting exactly at `end` must not be
    // scored (fixes double-counting when start is hour-aligned and duration
    // is a multiple of 60).
    for (let hour = start; hour < end; hour += 60 * MS_PER_MINUTE) {
      total += preferenceScoreAt(matrix, new Date(hour), timezone);
    }

    if (best === null || total > best.score) {
      best = { start, score: total };
    }
  }

  return best ? new Date(best.start) : null;
}

/**
 * The whole engine: rank sessions by urgency/preference, then greedily place
 * each one into the best free preference-scored slot, accumulating placed
 * intervals into `occupied` so later (less urgent) sessions never collide
 * with earlier ones. A session `bestFreeSlot` can't place is skipped, not
 * errored.
 */
export function optimize(
  sessions: HeuristicSession[],
  occupied: Interval[],
  now: Date,
  windowStart: Date,
  windowEnd: Date,
  prefMatrix: number[],
  timezone: string,
): Placement[] {
  const sorted = sortEDF(sessions, now);
  const acc: Interval[] = [...occupied];
  const placements: Placement[] = [];

  for (const session of sorted) {
    const start = bestFreeSlot(
      session.durationMinutes,
      acc,
      windowStart,
      session.deadline > windowEnd ? windowEnd : session.deadline,
      prefMatrix,
      timezone,
    );
    if (start === null) continue;

    const end = start.getTime() + session.durationMinutes * MS_PER_MINUTE;
    acc.push({ start: start.getTime(), end });
    placements.push({ id: session.id, scheduledStartTime: start });
  }

  return placements;
}
