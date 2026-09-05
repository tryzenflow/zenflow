import { zonedDate, zonedWallClockToUtc } from "@zenflow/core";
import {
  addMonths as dateFnsAddMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  startOfDay,
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

export const WEEK_STARTS_ON = 1;

export const MONTH_PILL_CAP = 2;

export const MONTH_CELL_VISIBILITY_WEIGHTS = {
  EXAM: 10,
  ASSIGNMENT: 5,
  LECTURE: 3,
  TASK: 1,
  DND: 0,
};

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

export interface CellSessionSplit<T> {
  visible: T[];
  overflowCount: number;
}

/**
 * Split a day's tasks into what a `MonthCell` renders directly vs. what
 * rolls into the "+N more" overflow pill. Fixed at `cap` (2 — the mockup /
 * issue checklist's cap; deliberately NOT responsive to cell height, see
 * GitHub issue #21's "open questions").
 */
export function splitCellSessions<T>(
  tasks: T[],
  cap: number = MONTH_PILL_CAP,
): CellSessionSplit<T> {
  if (tasks.length <= cap) {
    return { visible: tasks, overflowCount: 0 };
  }
  return { visible: tasks.slice(0, cap), overflowCount: tasks.length - cap };
}

interface ScheduledLike {
  scheduledStartTime: string | null;
  durationMinutes: number;
}

/**
 * Module-private marker for a shallow-cloned "tail" entry `groupSessionsByDate`
 * adds to the *next* day's bucket when a session's scheduled interval crosses
 * midnight — see {@link isContinuationEntry}. A `Symbol` property (rather than
 * a visible field) keeps `T`'s shape untouched, so the function's return type
 * stays a plain `Map<string, T[]>` and every existing consumer (drag payloads,
 * `SessionListSheet`, `updateSession` calls, …) keeps working unmodified on a
 * continuation entry — it IS the same session, just also needs a distinct
 * on-screen treatment where it appears a second time.
 */
const CONTINUATION_MARKER = Symbol("month-continuation");

/**
 * True for a continuation entry `groupSessionsByDate` synthesized for a
 * session that crosses midnight — the tail copy placed in the *next* day's
 * bucket. `MonthCell`/`MonthPill` use this to render it distinctly ("this is
 * the tail of something that started yesterday", not a second session), and
 * drag-start handlers use it to refuse to drag/reschedule that copy — same
 * read-only rule the day/week timeline applies to a `segment.continued`
 * block (`task-block.tsx`'s `isSplit`).
 */
export function isContinuationEntry(task: object): boolean {
  return CONTINUATION_MARKER in task;
}

/** True when `task`'s scheduled interval (in `tz`) runs past the midnight
 * that ends its start day — the `{ scheduledStartTime, durationMinutes }`
 * counterpart of `@zenflow/core`'s `crossesMidnight(event, tz)` (which takes
 * an already-resolved `{ start, end }` `Event`). Mirrors
 * `mobile/lib/blocks.ts`'s `eventsForDay` `continues` check (`evEndMs >
 * dayEndMs`) rather than a same-day comparison, so a session ending exactly
 * at midnight — no actual minute spills into the next day — does not get a
 * next-day tail. */
function crossesMidnightSession(task: ScheduledLike, tz: string): boolean {
  if (!task.scheduledStartTime) return false;
  const startMsValue = Date.parse(task.scheduledStartTime);
  const startWall = zonedDate(task.scheduledStartTime, tz);
  const dayStartWall = startOfDay(startWall);
  const nextDayWall = new Date(dayStartWall);
  nextDayWall.setDate(nextDayWall.getDate() + 1);
  const dayEndMs = zonedWallClockToUtc(nextDayWall, tz).getTime();
  const endMs = startMsValue + task.durationMinutes * 60_000;
  return endMs > dayEndMs;
}

export function groupSessionsByDate<T extends ScheduledLike>(
  tasks: T[],
  tz: string,
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  const add = (key: string, task: T) => {
    const existing = map.get(key);
    if (existing) existing.push(task);
    else map.set(key, [task]);
  };
  for (const task of tasks) {
    if (!task.scheduledStartTime) continue;
    const startWall = zonedDate(task.scheduledStartTime, tz);
    add(dateKey(startWall), task);

    if (crossesMidnightSession(task, tz)) {
      const nextDayWall = new Date(startWall);
      nextDayWall.setDate(nextDayWall.getDate() + 1);
      const continuation: T = { ...task, [CONTINUATION_MARKER]: true };
      add(dateKey(nextDayWall), continuation);
    }
  }
  // `Array.prototype.sort` is stable (ES2019+), so tasks sharing a start time
  // keep the order the API returned them in.
  for (const group of map.values()) {
    group.sort((a, b) => startMs(a) - startMs(b));
  }
  return map;
}

/** Epoch ms of a task's scheduled start; 0 for the unscheduled tasks
 * `groupSessionsByDate` has already filtered out (keeps the comparator total
 * without a non-null assertion). */
function startMs(task: ScheduledLike): number {
  return task.scheduledStartTime ? Date.parse(task.scheduledStartTime) : 0;
}
