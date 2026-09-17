import {
  ceilToSlot,
  floorToSlot,
  Interval,
  MS_PER_MINUTE,
  overlapsAny,
  SLOT_MS,
} from "./slot";
import { effectivePreferenceMatrix, preferenceScoreAt } from "./preference";
import { utcToMinutes } from "../../common/utils";
import { STABILITY_SATURATION_HOURS, STABILITY_WEIGHT } from "../constants";

const HOUR_MS = 60 * MS_PER_MINUTE;

/**
 * Slot preference scoring + best-free-slot search — pure, no I/O, no clock,
 * no randomness (CLAUDE.md invariant 2). Matrix helpers live in
 * `preference.ts`; interval math in `slot.ts`.
 */

/**
 * Overlap-weighted preference score of a concrete interval `[startMs, endMs)`:
 * the sum, over every local clock-hour block `[h, h+1)` the interval touches,
 * of `overlapFraction · pref[weekday(h)][h]`, where `overlapFraction` is the
 * portion of that hour block covered by the interval (0…1). A slot that only
 * partially covers an hour contributes that hour fractionally — e.g. a
 * 09:15–11:00 slot scores `0.75·pref[..][9] + 1.0·pref[..][10]`. `[start, end)`
 * is half-open, so the block starting exactly at `end` is never scored.
 * `prefMatrix` is passed through {@link effectivePreferenceMatrix}. Pure — the
 * local hour boundaries are derived from `timezone` (handles fractional UTC
 * offsets and DST).
 */
export function slotPreferenceScore(
  prefMatrix: number[],
  startMs: number,
  endMs: number,
  timezone: string,
): number {
  const matrix = effectivePreferenceMatrix(prefMatrix);
  let total = 0;
  let cursor = startMs;
  while (cursor < endMs) {
    // End of the local clock-hour block containing `cursor`.
    const minuteOfHour = utcToMinutes(new Date(cursor), timezone) % 60;
    const blockEnd = cursor + (60 - minuteOfHour) * MS_PER_MINUTE;
    const segEnd = Math.min(blockEnd, endMs);
    const weight = (segEnd - cursor) / HOUR_MS;
    total += weight * preferenceScoreAt(matrix, new Date(cursor), timezone);
    cursor = segEnd;
  }
  return total;
}

/**
 * Signed, ready-to-add "don't churn this without good reason" penalty for
 * moving a session away from the start time the user last set manually
 * (`prevStartMs`) — same "return the final signed contribution" convention
 * as {@link slotPreferenceScore}, so callers just add it directly. Always
 * `≤ 0`: the further `newStartMs` sits from `prevStartMs`, the more negative,
 * saturating at `STABILITY_SATURATION_HOURS` so a candidate a day away is no
 * more penalized than one just past the saturation point — see
 * `STABILITY_WEIGHT` in `constants.ts` for why the cap is sized the way it
 * is relative to the other scoring terms.
 */
export function stabilityScore(prevStartMs: number, newStartMs: number) {
  const distanceHours = Math.abs(newStartMs - prevStartMs) / HOUR_MS;
  const saturation =
    Math.min(distanceHours, STABILITY_SATURATION_HOURS) /
    STABILITY_SATURATION_HOURS;
  return -STABILITY_WEIGHT * saturation;
}

/**
 * Scan every 15-minute-aligned candidate start in `[windowStart, windowEnd)`
 * and return the free one (no overlap with `occupied`) whose start-hour has the
 * highest preference score. Earliest start wins ties. `null` when nothing free
 * fits.
 *
 * `windowEnd` bounds the latest legal **start**. `fitWindowEnd` (default
 * `windowEnd`) bounds the latest legal **end** — pass a later instant to let a
 * task start before `windowEnd` yet finish after it. Cross-midnight placement
 * uses `windowEnd = nextMidnight`, `fitWindowEnd = min(deadline, nextMidnight +
 * duration − one slot)`, so a task may start as late as 23:45 and run its full
 * length into the small hours (`io/heuristic-placer.service.ts`).
 *
 * `prevStartMs`, when given, adds {@link stabilityScore}'s light penalty for
 * drifting away from the session's last manually-set start, so an otherwise
 * tied or near-tied candidate that's closer to it wins.
 */
export function bestFreeSlot(
  durationMinutes: number,
  occupied: Interval[],
  windowStart: Date,
  windowEnd: Date,
  prefMatrix: number[],
  timezone: string,
  fitWindowEnd: Date = windowEnd,
  prevStartMs?: number,
): Date | null {
  const durationMs = durationMinutes * MS_PER_MINUTE;
  // Both ceilings are typically capped to a session's deadline by the caller,
  // and deadlines are arbitrary user-entered instants — not guaranteed to be
  // slot-aligned. Round DOWN so a session is never placed to finish past the
  // exact deadline instant (rounding up here would let it finish up to one
  // slot late, which is an EDF-correctness bug).
  const startCeilMs = floorToSlot(windowEnd.getTime());
  const fitCeilMs = floorToSlot(fitWindowEnd.getTime());

  let best: { start: number; score: number } | null = null;
  for (
    let start = ceilToSlot(windowStart.getTime());
    start < startCeilMs;
    start += SLOT_MS
  ) {
    const end = start + durationMs;
    if (end > fitCeilMs) continue;
    if (overlapsAny(occupied, start, end)) continue;

    const total =
      slotPreferenceScore(prefMatrix, start, end, timezone) +
      (prevStartMs !== undefined ? stabilityScore(prevStartMs, start) : 0);
    if (best === null || total > best.score) {
      best = { start, score: total };
    }
  }

  return best ? new Date(best.start) : null;
}
