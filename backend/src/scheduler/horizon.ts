import type { ViewMode } from "@zenflow/shared";
import { addDaysStr, isoWeekday } from "./slot";

/**
 * Calendar-window helpers used both for placement bounds and for the
 * GET /tasks `meta` capacity figures. All inputs/outputs are 'YYYY-MM-DD'
 * local-date strings (in the user's timezone) unless noted.
 */

/** Monday of the week containing `dateStr` (ISO weeks start Monday). */
export function weekStartStr(dateStr: string): string {
  const wd = isoWeekday(dateStr); // 1=Mon … 7=Sun
  return addDaysStr(dateStr, -(wd - 1));
}

/** First and last calendar day of the month containing `dateStr`. */
export function monthRange(dateStr: string): {
  startStr: string;
  endStr: string;
} {
  const [y, m] = dateStr.split("-").map(Number);
  const startStr = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate(); // day 0 of next month
  const endStr = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { startStr, endStr };
}

/** Inclusive local-date range a given view spans, for display + meta. */
export function viewDayRange(
  view: ViewMode,
  refDateStr: string,
): { startStr: string; endStr: string } {
  switch (view) {
    case "day":
      return { startStr: refDateStr, endStr: refDateStr };
    case "week": {
      const startStr = weekStartStr(refDateStr);
      return { startStr, endStr: addDaysStr(startStr, 6) };
    }
    case "month":
      return monthRange(refDateStr);
  }
}

/**
 * Inclusive local-date range to FETCH/DISPLAY for a view, which can be wider
 * than the focal {@link viewDayRange}. For `month`, the focal month is padded
 * out to whole Monday-started weeks so the response covers every cell the
 * frontend month grid renders (`startOfWeek(startOfMonth)`..`endOfWeek(
 * endOfMonth)`, Monday week start) — otherwise the leading/trailing
 * adjacent-month days would be blank. `week`/`day` need no padding and are
 * identical to {@link viewDayRange}.
 */
export function displayDayRange(
  view: ViewMode,
  refDateStr: string,
): { startStr: string; endStr: string } {
  if (view !== "month") return viewDayRange(view, refDateStr);
  const { startStr: monthStart, endStr: monthEnd } = monthRange(refDateStr);
  return {
    startStr: weekStartStr(monthStart),
    endStr: addDaysStr(weekStartStr(monthEnd), 6),
  };
}

/** Walk backwards from `dateStr` (inclusive) to the nearest work day. */
export function lastWorkdayOnOrBefore(
  dateStr: string,
  workDays: number[],
  floorStr: string,
): string {
  let cur = dateStr;
  for (let i = 0; i < 14 && cur >= floorStr; i++) {
    if (workDays.includes(isoWeekday(cur))) return cur;
    cur = addDaysStr(cur, -1);
  }
  return dateStr; // fallback: caller still bounds by deadline / capacity
}

/** Total schedulable work minutes across [startStr,endStr] inclusive. */
export function sumWorkMinutes(
  startStr: string,
  endStr: string,
  workStart: number,
  workEnd: number,
  workDays: number[],
): number {
  const perDay = Math.max(0, workEnd - workStart);
  let total = 0;
  let cur = startStr;
  for (let i = 0; i < 366 && cur <= endStr; i++) {
    if (workDays.includes(isoWeekday(cur))) total += perDay;
    cur = addDaysStr(cur, 1);
  }
  return total;
}
