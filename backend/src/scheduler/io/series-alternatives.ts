import { MS_PER_MINUTE, overlapsAny, type Interval } from "../core/slot";

/** One series sitting as seen by {@link selectSeriesAlternatives}. */
export interface SeriesSittingPair {
  durationMinutes: number;
  /** Final applied start (after last-resort pinning). */
  appliedStartMs: number;
  /**
   * The other plan's start for this sitting, or `null` when it isn't a
   * candidate (a plan pick missing, applied outcome was the last resort, …).
   */
  otherStartMs: number | null;
}

/**
 * Which sittings of a pairwise-sampled `TASK` series surface their
 * alternative (#58). Pure presentation filter over the two plans Python
 * returned — no ranking. A sitting qualifies when its other-plan start
 * differs from the applied one and that alternative interval overlaps
 * neither `fixedOccupied` nor any OTHER sitting's applied interval (the
 * other plan's ledger is independent of the applied one, so this can
 * happen). The first `max` qualifying sittings by index are returned, in
 * index order.
 */
export function selectSeriesAlternatives(
  sittings: SeriesSittingPair[],
  fixedOccupied: Interval[],
  max: number,
): number[] {
  const applied: Interval[] = sittings.map((s) => ({
    start: s.appliedStartMs,
    end: s.appliedStartMs + s.durationMinutes * MS_PER_MINUTE,
  }));
  const shown: number[] = [];
  for (let i = 0; i < sittings.length && shown.length < max; i++) {
    const { otherStartMs, appliedStartMs, durationMinutes } = sittings[i];
    if (otherStartMs === null || otherStartMs === appliedStartMs) continue;
    const end = otherStartMs + durationMinutes * MS_PER_MINUTE;
    const siblings = applied.filter((_, j) => j !== i);
    if (overlapsAny(siblings, otherStartMs, end)) continue;
    if (overlapsAny(fixedOccupied, otherStartMs, end)) continue;
    shown.push(i);
  }
  return shown;
}
