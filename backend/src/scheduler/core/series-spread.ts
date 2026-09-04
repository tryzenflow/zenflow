/**
 * Pure helpers for spreading a `TASK` series' sessions (`sessionCount > 1`)
 * across the `now … deadline` window. No I/O, no clock — same discipline as
 * `slot.ts` (CLAUDE.md invariant 2). See `docs/scheduler/architecture.md`
 * ("Series bounded window").
 */

/**
 * `count` non-decreasing day offsets in `[0, daySpan]`, spread as evenly as
 * possible — session `i` targets `round(i · daySpan / (count − 1))`. The first
 * session targets day 0 (the scan start), the last targets `daySpan` (the
 * deadline day). `count === 1` → `[0]`.
 */
export function seriesDayOffsets(daySpan: number, count: number): number[] {
  const span = Math.max(0, Math.floor(daySpan));
  if (count <= 1) return [0];
  const offsets: number[] = [];
  for (let i = 0; i < count; i++) {
    offsets.push(Math.round((i * span) / (count - 1)));
  }
  return offsets;
}

/**
 * The candidate-day window for one series member, as `[lo, hi]` day offsets
 * (inclusive) clamped to `[0, daySpan]`. Each member may drift at most
 * `clamp = max(1, floor(daySpan / count))` days from its even-spread `target`
 * (D3) — wide windows for a sparse series, `±1` for a dense one — so members
 * stay spread out while a tight or ideal day can still absorb 2–3 sittings.
 */
export function clampWindowForMember(
  daySpan: number,
  count: number,
  target: number,
): [number, number] {
  const span = Math.max(0, Math.floor(daySpan));
  const clamp = Math.max(1, Math.floor(span / Math.max(1, count)));
  const lo = Math.max(0, target - clamp);
  const hi = Math.min(span, target + clamp);
  return [lo, hi];
}
