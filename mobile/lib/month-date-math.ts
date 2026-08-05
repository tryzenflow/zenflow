import { zonedDate } from "@zenflow/core";
import {
  addMonths as dateFnsAddMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from "date-fns";

/**
 * Pure date-math + overflow-counting helpers for the mobile Month View
 * (`app/(app)/month.tsx`, `components/calendar/month-*`). Kept framework-
 * agnostic (no React/RN imports) so they're unit-testable with a plain
 * Node/Vitest run — see `lib/__tests__/month-date-math.test.ts`.
 *
 * Mirrors `frontend/src/components/calendar/month-grid.tsx`'s Monday-first
 * "pad to whole weeks" grid math (same `WEEK_STARTS_ON = 1` as
 * `frontend/src/utils/constants.ts`), translated to RN idioms.
 */

export const WEEK_STARTS_ON = 1 as const;

export const MONTH_PILL_CAP = 2;

/**
 * Every date-of-day rendered in a month's grid: the Monday-first weeks
 * spanning `startOfMonth(monthDate)`..`endOfMonth(monthDate)`, padded with
 * whatever adjacent leading/trailing days complete the first/last week.
 * Produces 35 or 42 entries depending on how the month falls — never padded
 * further, so a 5-week month stays 5 rows instead of always forcing 6.
 */
export function getMonthGridDays(monthDate: Date): Date[] {
  return eachDayOfInterval({
    start: startOfWeek(startOfMonth(monthDate), {
      weekStartsOn: WEEK_STARTS_ON,
    }),
    end: endOfWeek(endOfMonth(monthDate), { weekStartsOn: WEEK_STARTS_ON }),
  });
}

/** True when `day` falls outside the calendar month `monthDate` represents. */
export function isOutsideMonth(day: Date, monthDate: Date): boolean {
  return !isSameMonth(day, monthDate);
}

/** Monday-first column index (0 = Mon … 6 = Sun) is a weekend column. */
export function isWeekendColumn(columnIndex: number): boolean {
  return columnIndex === 5 || columnIndex === 6;
}

/** Stable `'YYYY-MM-DD'` grouping key for a day (already in user-tz space). */
export function dateKey(day: Date): string {
  return format(day, "yyyy-MM-dd");
}

/** Header label for the paginated month header, e.g. "June 2026". */
export function monthLabel(monthDate: Date): string {
  return format(monthDate, "MMMM yyyy");
}

/** Same-named wrapper around `date-fns`' `addMonths`, re-exported so callers
 * only need this one module for month-grid date math. */
export function addMonths(monthDate: Date, delta: number): Date {
  return dateFnsAddMonths(monthDate, delta);
}

export interface CellTaskSplit<T> {
  visible: T[];
  overflowCount: number;
}

/**
 * Split a day's tasks into what a `MonthCell` renders directly vs. what
 * rolls into the "+N more" overflow pill. Fixed at `cap` (2 — the mockup /
 * issue checklist's cap; deliberately NOT responsive to cell height, see
 * GitHub issue #21's "open questions").
 */
export function splitCellTasks<T>(
  tasks: T[],
  cap: number = MONTH_PILL_CAP,
): CellTaskSplit<T> {
  if (tasks.length <= cap) {
    return { visible: tasks, overflowCount: 0 };
  }
  return { visible: tasks.slice(0, cap), overflowCount: tasks.length - cap };
}

interface ScheduledLike {
  scheduledStartTime: string | null;
}

/**
 * Group a flat task list by the user-tz calendar day its
 * `scheduledStartTime` falls on. Tasks with no `scheduledStartTime` are
 * omitted — mirrors `frontend/src/components/calendar/month-grid.tsx`'s
 * `isSameDay(d, zonedDate(e.start, tz))` filter, which only ever runs over
 * already-placed events.
 */
export function groupTasksByDate<T extends ScheduledLike>(
  tasks: T[],
  tz: string,
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const task of tasks) {
    if (!task.scheduledStartTime) continue;
    const key = dateKey(zonedDate(task.scheduledStartTime, tz));
    const existing = map.get(key);
    if (existing) existing.push(task);
    else map.set(key, [task]);
  }
  return map;
}
