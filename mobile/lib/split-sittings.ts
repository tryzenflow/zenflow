import { SLOT_MINUTES } from "@zenflow/shared";

/**
 * Sizes of the sittings a task splits into, in minutes. The slots are dealt out
 * evenly and the first sittings take the extra ones, so no two sittings differ
 * by more than 15 minutes: `[120, 3]` gives `[45, 45, 30]` and `[120, 6]` gives
 * `[30, 30, 15, 15, 15, 15]`. A task shorter than its count of slots yields one
 * sitting per slot.
 */
export function sittingMinutes(total: number, count: number): number[] {
  const slots = Math.max(1, Math.round(total / SLOT_MINUTES));
  const n = Math.max(1, Math.min(Math.floor(count), slots));
  const base = Math.floor(slots / n);
  const extra = slots % n;
  return Array.from({ length: n }, (_, i) =>
    (base + (i < extra ? 1 : 0)) * SLOT_MINUTES,
  );
}

/** Counts a task of `total` minutes can split into: one to `max`, one sitting per slot at most. */
export function splitCounts(total: number, max: number): number[] {
  const slots = Math.max(1, Math.round(total / SLOT_MINUTES));
  return Array.from({ length: Math.min(slots, max) }, (_, i) => i + 1);
}

/** The largest valid count not above `want`, or the smallest one. */
export function snapCount(counts: number[], want: number): number {
  let best = counts[0] ?? 1;
  for (const c of counts) if (c <= want) best = c;
  return best;
}
