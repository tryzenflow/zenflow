import { MAX_SCAN_DAYS } from "./constants";
import { durationMs, findSlot } from "./edf";
import { SchedulerPrefs } from "./interfaces";
import {
  Interval,
  SLOT_MS,
  addDaysStr,
  ceilToSlot,
  localDateStr,
  overlapsAny,
} from "./slot";
import { minutesToUtc } from "../common/utils";
import { monthRange, weekStartStr } from "./horizon";

/** Granularity of the "next available period" recovery option. */
export type OverflowGranularity = "day" | "week" | "month";

/**
 * Earliest contiguous 15-min-grid slot of `durationMinutes` starting at/after
 * `now`, NOT bounded by the working-hours window or work days, that avoids every
 * `occupied` interval and ends at or before `deadline`. This is the "schedule
 * outside working hours" recovery option offered when {@link findSlot} can't
 * place a task within working hours before its deadline.
 *
 * Pure: takes `now` as a parameter and does no I/O. Returns null when there is
 * no room before the deadline even ignoring working hours (e.g. the deadline is
 * too tight, or every off-hours gap is occupied).
 */
export function findSlotIgnoringWorkHours(
  durationMinutes: number,
  deadline: Date | null,
  occupied: Interval[],
  now: Date,
): Date | null {
  const durMsValue = durationMs(durationMinutes);
  const deadlineMs = deadline ? deadline.getTime() : null;
  // No deadline → there is always an off-hours slot (the very next free grid
  // window from now). A null deadline is unusual on this path (the overflow
  // options only trigger for unplaced tasks, which today means a deadline that
  // couldn't be met), but handle it defensively with the same scan.
  const startGrid = ceilToSlot(now.getTime());
  const horizonMs = MAX_SCAN_DAYS * 24 * 60 * 60_000;
  const scanEnd = deadlineMs !== null ? deadlineMs : startGrid + horizonMs;

  for (let cand = startGrid; cand + durMsValue <= scanEnd; cand += SLOT_MS) {
    const candEnd = cand + durMsValue;
    if (!overlapsAny(occupied, cand, candEnd)) return new Date(cand);
  }
  return null;
}

/**
 * Start-of-day 'YYYY-MM-DD' (user tz) of the next period boundary after the day
 * containing `now`, for the given granularity:
 *  - "day"   → the next calendar day,
 *  - "week"  → the Monday of the next ISO week,
 *  - "month" → the 1st of the next month.
 */
function nextPeriodStartStr(
  now: Date,
  granularity: OverflowGranularity,
  timezone: string,
): string {
  const todayStr = localDateStr(now, timezone);
  switch (granularity) {
    case "day":
      return addDaysStr(todayStr, 1);
    case "week": {
      // Monday of this week, then advance one week.
      const thisWeekStart = weekStartStr(todayStr);
      return addDaysStr(thisWeekStart, 7);
    }
    case "month": {
      const { startStr } = monthRange(todayStr);
      // First day of the month, +1 month via the last-day trick.
      const [y, m] = startStr.split("-").map(Number);
      const nextY = m === 12 ? y + 1 : y;
      const nextM = m === 12 ? 1 : m + 1;
      return `${String(nextY).padStart(4, "0")}-${String(nextM).padStart(2, "0")}-01`;
    }
  }
}

/**
 * Earliest in-working-hours slot of `durationMinutes` (same window/work-day
 * rules as {@link findSlot}) but IGNORING the task's deadline, where the scan
 * begins at the start of the next period boundary relative to `now`:
 *  - "day"   → from the start of the next working day,
 *  - "week"  → from the start of the next week,
 *  - "month" → from the start of the next month.
 *
 * This is the "schedule the next available day/week/month" recovery option.
 * Respects every `occupied` interval and reuses {@link findSlot}'s window/grid
 * math. Pure: takes `now` as a parameter and does no I/O. Returns null only when
 * no working-hours slot is found within {@link MAX_SCAN_DAYS} of the boundary.
 */
export function findNextAvailableSlot(
  prefs: SchedulerPrefs,
  durationMinutes: number,
  occupied: Interval[],
  now: Date,
  granularity: OverflowGranularity,
): Date | null {
  const boundaryStr = nextPeriodStartStr(now, granularity, prefs.timezone);
  // The boundary's start-of-day UTC instant becomes the new floor. findSlot
  // clamps every candidate to >= max(now, earliest), so passing the boundary as
  // `earliest` makes the scan start from the next period. The deadline is
  // deliberately null here (this option ignores the deadline).
  const earliest = minutesToUtc(boundaryStr, 0, prefs.timezone);
  return findSlot(prefs, durationMinutes, null, occupied, now, earliest);
}
