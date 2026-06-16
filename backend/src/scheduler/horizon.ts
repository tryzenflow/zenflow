import type { ViewMode } from "@zenflow/shared";
import {
  addDaysStr,
  isoWeekday,
  localDateStr,
  workWindowMinutes,
} from "./slot";
import { minutesToUtc } from "../common/utils";

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

/**
 * Local-date 'YYYY-MM-DD' bounds of the calendar period containing `dateStr`,
 * for the given view:
 *  - "day"   → that day, and the next day,
 *  - "week"  → Monday of its ISO week, and the following Monday,
 *  - "month" → the 1st of its month, and the 1st of the next month.
 *
 * `startStr` is the inclusive first day of the period; `nextStr` is the
 * EXCLUSIVE upper bound (the first day of the next period). Reuses
 * {@link weekStartStr} / {@link monthRange} so the period definition matches the
 * display/meta ranges the frontend calendar uses. Pure string math.
 */
export function periodBoundsStr(
  view: ViewMode,
  dateStr: string,
): { startStr: string; nextStr: string } {
  switch (view) {
    case "day":
      return { startStr: dateStr, nextStr: addDaysStr(dateStr, 1) };
    case "week": {
      const startStr = weekStartStr(dateStr);
      return { startStr, nextStr: addDaysStr(startStr, 7) };
    }
    case "month": {
      const { startStr } = monthRange(dateStr);
      const [y, m] = startStr.split("-").map(Number);
      const nextY = m === 12 ? y + 1 : y;
      const nextM = m === 12 ? 1 : m + 1;
      const nextStr = `${String(nextY).padStart(4, "0")}-${String(nextM).padStart(2, "0")}-01`;
      return { startStr, nextStr };
    }
  }
}

/**
 * Absolute UTC bounds of the calendar period (day / ISO-week / month) the
 * `anchor` instant falls in, in the user's `timezone`. `start` is the period's
 * start-of-day; `end` is the EXCLUSIVE upper bound — the start-of-day of the
 * first day of the NEXT period — which is exactly the ceiling a no-deadline
 * task may be placed before (findSlot requires `candEnd <= end`). The I/O/tz
 * layer (scheduler.service) derives a task's `schedulingDeadline` from `end`.
 * Pure: derives the local date of `anchor` in `timezone`, then walks period
 * boundaries with pure string math.
 */
export function periodRange(
  anchor: Date,
  view: ViewMode,
  timezone: string,
): { start: Date; end: Date } {
  // Local date of the anchor in the user's tz (the anchor is already a
  // start-of-day UTC instant for the create day, but localize defensively).
  const dateStr = localDateStr(anchor, timezone);
  const { startStr, nextStr } = periodBoundsStr(view, dateStr);
  return {
    start: minutesToUtc(startStr, 0, timezone),
    end: minutesToUtc(nextStr, 0, timezone),
  };
}

/**
 * Exclusive end-of-period UTC instant (the ceiling) for the period containing
 * `anchor` — the start-of-day of the first day of the next day/week/month.
 * Thin wrapper over {@link periodRange}; this is a task's `schedulingDeadline`.
 */
export function endOfPeriod(
  anchor: Date,
  view: ViewMode,
  timezone: string,
): Date {
  return periodRange(anchor, view, timezone).end;
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
  // Each workday contributes its effective minutes once (start-day anchored);
  // an overnight window's morning tail is not double-counted on day D+1.
  const perDay = workWindowMinutes(workStart, workEnd);
  let total = 0;
  let cur = startStr;
  for (let i = 0; i < 366 && cur <= endStr; i++) {
    if (workDays.includes(isoWeekday(cur))) total += perDay;
    cur = addDaysStr(cur, 1);
  }
  return total;
}
