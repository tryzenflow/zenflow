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
