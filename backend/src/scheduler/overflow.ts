import { durationMs, findSlot } from "./edf";
import { SchedulerPrefs } from "./interfaces";
import { Interval, SLOT_MS, ceilToSlot, overlapsAny } from "./slot";
import { periodRange } from "./horizon";
import type { ViewMode } from "@zenflow/shared";

/** Granularity of the "next available period" recovery option. */
export type OverflowGranularity = ViewMode;

/**
 * Earliest contiguous 15-min-grid slot of `durationMinutes`, NOT bounded by the
 * working-hours window or work days, that fits INSIDE the anchor period window
 * `[periodStart, periodEnd)` (the viewed day/week/month), starts at/after `now`,
 * avoids every `occupied` interval, and ends at/before the user `deadline` (when
 * present). This is the "schedule outside working hours" recovery option offered
 * when {@link findSlot} can't place a task within working hours inside the
 * period (e.g. it's 23:00 and the day's work window is over).
 *
 * Pure: takes `now` + the explicit period bounds as parameters and does no I/O.
 * Returns null when no off-hours slot fits inside the period before the deadline
 * (the period has ended, or every remaining gap is occupied / past the deadline).
 */
export function findSlotIgnoringWorkHours(
  durationMinutes: number,
  deadline: Date | null,
  occupied: Interval[],
  now: Date,
  periodStart: Date,
  periodEnd: Date,
): Date | null {
  const durMsValue = durationMs(durationMinutes);
  // Floor: the later of `now` and the period start, snapped up to the grid.
  const startGrid = ceilToSlot(Math.max(now.getTime(), periodStart.getTime()));
  // Ceiling: the period end, tightened by the user deadline when it lands
  // earlier. The slot must END at/before this instant.
  const deadlineMs = deadline ? deadline.getTime() : Infinity;
  const scanEnd = Math.min(periodEnd.getTime(), deadlineMs);

  for (let cand = startGrid; cand + durMsValue <= scanEnd; cand += SLOT_MS) {
    const candEnd = cand + durMsValue;
    if (!overlapsAny(occupied, cand, candEnd)) return new Date(cand);
  }
  return null;
}

/**
 * Earliest in-working-hours slot of `durationMinutes` (same window/work-day
 * rules as {@link findSlot}) in the NEXT calendar period after the anchor's
 * period, ignoring the task's deadline. The scan begins at the start of:
 *  - "day"   → the next calendar day,
 *  - "week"  → the next ISO week (Monday),
 *  - "month" → the next month.
 *
 * This is the "schedule the next available day/week/month" recovery option.
 * Respects every `occupied` interval and reuses {@link findSlot}'s window/grid
 * math. Pure: takes `now` + the anchor period parameters and does no I/O.
 * Returns null only when no working-hours slot is found within
 * {@link MAX_SCAN_DAYS} of the next-period boundary.
 */
export function findNextAvailableSlot(
  prefs: SchedulerPrefs,
  durationMinutes: number,
  occupied: Interval[],
  now: Date,
  anchor: Date,
  granularity: OverflowGranularity,
): Date | null {
  // The exclusive end of the anchor period is exactly the start of the next
  // period. Passing it as `findSlot`'s `earliest` floor makes the scan begin at
  // the next-period boundary; findSlot clamps every candidate to >= now too, so
  // a period already in the past collapses to scanning from now. The deadline is
  // deliberately null here (this option ignores the deadline).
  const { end: nextPeriodStart } = periodRange(
    anchor,
    granularity,
    prefs.timezone,
  );
  return findSlot(prefs, durationMinutes, null, occupied, now, nextPeriodStart);
}
