import { addDays, format, startOfWeek } from "date-fns";

/**
 * Pure date-math helpers for the mobile Week View (`app/(app)/week.tsx`,
 * `components/calendar/week-pager.tsx`, `components/calendar/week-header.tsx`).
 * Kept framework-agnostic (no React/RN imports) so they're unit-testable with
 * a plain Node/Vitest run — see `lib/__tests__/week-date-math.test.ts`.
 *
 * Same Monday-first week convention as `lib/month-date-math.ts` (and
 * `@zenflow/core`'s `WEEK_STARTS_ON`), translated to the fixed 7-day window a
 * week pager pages through.
 */

export const WEEK_STARTS_ON = 1 as const;

/** Stable `'YYYY-MM-DD'` grouping key for a day (already in user-tz space). */
export function dateKey(day: Date): string {
  return format(day, "yyyy-MM-dd");
}

/** Monday of the ISO week containing `day` (zeroed to midnight local time). */
export function weekStart(day: Date): Date {
  return startOfWeek(day, { weekStartsOn: WEEK_STARTS_ON });
}

/** The 7 consecutive dates of `day`'s week, Monday first, each at midnight. */
export function weekDays(day: Date): Date[] {
  const start = weekStart(day);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** Monday-first column index of a day within its week (0 = Mon … 6 = Sun). */
export function dayIndexInWeek(day: Date): number {
  return (day.getDay() + 6) % 7;
}

/** Shift `day` by `n` whole weeks, preserving the weekday. */
export function shiftWeek(day: Date, delta: number): Date {
  return addDays(day, delta * 7);
}

/** Shift `day` by `n` days. */
export function shiftDays(day: Date, delta: number): Date {
  return addDays(day, delta);
}
