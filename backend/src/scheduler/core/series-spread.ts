/**
 * Pure helpers for spreading a `TASK` series' sessions (`sessionCount > 1`)
 * across the `now … deadline` window. No I/O, no clock — same discipline as
 * `slot.ts` (CLAUDE.md invariant 2). See `docs/scheduler/architecture.md`
 * ("Series bounded window").
 */

/**
 * Non-overlapping day-window `[lo, hi]` (inclusive day offsets from the scan
 * start) for each of `count` members spread across `[0, daySpan]`
 * (`daySpan + 1` calendar days).
 *
 * Replaces the old "even-spread target day ± a symmetric clamp" approach:
 * that scheme's windows could overlap between adjacent members — the target
 * day itself was never guaranteed free, and a wide-enough clamp let two
 * members "reach into" the same day from opposite sides — so two sessions
 * could cluster onto one day while a neighboring day the series was
 * supposed to use sat empty.
 *
 * Here the `daySpan + 1` days are partitioned into `count` contiguous,
 * non-overlapping buckets instead: `base = floor((daySpan + 1) / count)`
 * days each, with the LAST `(daySpan + 1) % count` buckets getting one extra
 * day to absorb whatever doesn't divide evenly (so the series still starts
 * on day 0 and the remainder lands closest to the deadline, not spread
 * through the middle). Member `i`'s window is exactly its bucket — its
 * "freedom" to be placed anywhere inside it without ever touching another
 * member's bucket, so no two members' windows can overlap by construction.
 *
 * `count` may exceed `daySpan + 1` (more sessions requested than days
 * available) — buckets then collapse toward the tail, several members
 * sharing a single day's window. That's a genuinely unsolvable overlap (more
 * sessions than days), not something this function can spread away;
 * {@link MAX_SERIES_PER_DAY} and the series pre-flight
 * (`TaskPlacementService.canPlaceSeries`) are what keep that case safe, not
 * this function.
 */
export function seriesDayWindows(
  daySpan: number,
  count: number,
): [number, number][] {
  const span = Math.max(0, Math.floor(daySpan));
  const totalDays = span + 1;
  const n = Math.max(1, Math.floor(count));
  const base = Math.floor(totalDays / n);
  const remainder = totalDays % n;

  const windows: [number, number][] = [];
  let cursor = 0;
  for (let i = 0; i < n; i++) {
    const size = Math.max(1, base + (i >= n - remainder ? 1 : 0));
    const lo = Math.min(cursor, span);
    const hi = Math.min(span, lo + size - 1);
    windows.push([lo, hi]);
    cursor += size;
  }
  return windows;
}
