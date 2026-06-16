import { addDays, addMonths, addWeeks, startOfMonth, startOfWeek } from "date-fns";
import type { ViewMode } from "@/types/schedule";
import { WEEK_STARTS_ON } from "./constants";

export type NavDirection = "left" | "right";

/**
 * Step the calendar cursor by one unit of the active view's granularity:
 * day view moves by a day, week view by a week (snapped to the week start),
 * month view by a month (snapped to the month start).
 *
 * Shared by the header's prev/next buttons and the arrow-key shortcuts so the
 * two never drift apart. Operates on the user-tz wall-clock `Date` (its local
 * fields are the user's wall clock), keeping the timezone contract intact.
 */
export function shiftDateByView(
  date: Date,
  view: ViewMode,
  direction: NavDirection,
): Date {
  const step = direction === "left" ? -1 : 1;
  switch (view) {
    case "day":
      return addDays(date, step);
    case "week":
      return addWeeks(startOfWeek(date, { weekStartsOn: WEEK_STARTS_ON }), step);
    case "month":
      return addMonths(startOfMonth(date), step);
  }
}
