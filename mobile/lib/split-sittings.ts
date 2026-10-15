import { MAX_TASK_SESSION_COUNT } from "@zenflow/core";
import { SLOT_MINUTES } from "@zenflow/shared";

/** Longest sitting a split offers. Longer tasks need more sittings. */
export const MAX_SITTING_MINUTES = 4 * 60;

/** Sitting length a long task splits into by default. */
const DEFAULT_SITTING_MINUTES = 2 * 60;

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

/**
 * Counts a task of `total` minutes can split into: enough that no sitting runs
 * over {@link MAX_SITTING_MINUTES}, up to `max` and one sitting per slot.
 */
export function splitCounts(
  total: number,
  max: number = MAX_TASK_SESSION_COUNT,
): number[] {
  const slots = Math.max(1, Math.round(total / SLOT_MINUTES));
  const hi = Math.max(1, Math.min(slots, max));
  const lo = Math.min(hi, Math.max(1, Math.ceil(total / MAX_SITTING_MINUTES)));
  return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
}

/**
 * Count a new task of `total` minutes starts with: one sitting up to
 * {@link MAX_SITTING_MINUTES}, then two-hour sittings, so 8 hours gives 4 and
 * 120 hours gives 60.
 */
export function defaultSittingCount(total: number): number {
  if (total <= MAX_SITTING_MINUTES) return 1;
  const counts = splitCounts(total);
  return snapCount(counts, Math.ceil(total / DEFAULT_SITTING_MINUTES));
}

/** The largest valid count not above `want`, or the smallest one. */
export function snapCount(counts: number[], want: number): number {
  let best = counts[0] ?? 1;
  for (const c of counts) if (c <= want) best = c;
  return best;
}
