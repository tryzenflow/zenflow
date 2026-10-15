import { SLOT_MINUTES } from "@zenflow/shared";

/**
 * Sizes of the sittings a task splits into, in minutes. The total is kept
 * exactly on the 15-minute grid: the first sittings take the extra slot, so
 * `[180, 2]` gives `[90, 90]` and `[120, 3]` gives `[45, 45, 30]`. A task
 * shorter than its count of slots yields one sitting per slot instead.
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

/**
 * Sizes of the sittings with a little variation around the even split, still
 * summing to `total` on the 15-minute grid: 8 hours in 4 gives
 * `[135, 105, 135, 105]` minutes rather than four flat 2-hour blocks. Paired
 * sittings trade slots (one up, one down), the sign alternating pair by pair,
 * and none drops below one slot. The same input always gives the same output.
 */
export function variedSittings(total: number, count: number): number[] {
  const slots = sittingMinutes(total, count).map((m) => m / SLOT_MINUTES);
  const n = slots.length;
  const shift = Math.max(1, Math.round(slots[n - 1] * 0.125));
  for (let i = 0; i < Math.floor(n / 2); i++) {
    const j = n - 1 - i;
    const d = Math.min(shift, slots[i] - 1, slots[j] - 1);
    if (d <= 0) continue;
    const sign = i % 2 === 0 ? 1 : -1;
    slots[i] += sign * d;
    slots[j] -= sign * d;
  }
  return slots.map((s) => s * SLOT_MINUTES);
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

/** Minutes of each sitting when `total` splits into `count` equal sittings. */
export function sittingLength(total: number, count: number): number {
  return Math.round(total / Math.max(1, count));
}
