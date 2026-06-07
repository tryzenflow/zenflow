import { RRule } from "rrule";
import type { ViewMode } from "@zenflow/shared";
import { minutesToUtc } from "../../common/utils";
import { DAILY_HORIZON } from "../../common/constants";
import { isoWeekday, localDateStr } from "../../scheduler/slot";
import { viewDayRange } from "../../scheduler/horizon";

/** Strip the `RRULE:` prefix and surrounding lines, leaving the rule body. */
function rruleBody(rrule: string): string {
  return (
    rrule
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => /^RRULE[:;]/i.test(l))
      ?.replace(/^RRULE:/i, "") ?? rrule
  );
}

/**
 * Concrete occurrence days (YYYY-MM-DD in the user's tz) a recurring task
 * materializes into, given the view it was created from.
 *
 * The frontend emits a single FREQ rule bounded by UNTIL to the active
 * week/month. We anchor DTSTART to the *first day of that same window* (not the
 * day the user happened to click) so e.g. FREQ=DAILY across a week always
 * covers it. Each returned day becomes its own persisted Task row (same rrule +
 * seriesId, distinct id), which the EDF engine then places.
 *
 * Recurrence is workday-scoped: occurrences only ever land on the user's
 * working days. "Every X days" therefore skips non-working days, and month
 * recurrence expands its weekly BYDAY rule to every selected weekday across the
 * whole month (BYDAY overrides the DTSTART weekday), then filters to workdays.
 *
 * A non-recurring task (or Day view) collapses to the single anchor day, which
 * is kept verbatim even if it's a non-working day (an explicit one-off choice).
 *
 * When `deadlineDateStr` is given, no occurrence is materialized after that day
 * — recurrence is bounded by the task's deadline, not just the view window.
 *
 * When `floorDateStr` is given, recurrence starts there rather than at the
 * window's first day — so a series created mid-week/month begins from "now"
 * instead of back-filling days that have already passed.
 */
export function occurrenceDays(
  rrule: string,
  view: ViewMode,
  anchorDateStr: string,
  timezone: string,
  dtstartMinutes: number,
  workDays: number[],
  deadlineDateStr?: string,
  floorDateStr?: string,
): string[] {
  if (!rrule || view === "day") return [anchorDateStr];

  const { startStr, endStr } = viewDayRange(view, anchorDateStr);
  const isWorkday = (ds: string) => workDays.includes(isoWeekday(ds));
  const inRange = (ds: string) =>
    (!deadlineDateStr || ds <= deadlineDateStr) &&
    (!floorDateStr || ds >= floorDateStr);

  const windowStart = minutesToUtc(startStr, 0, timezone);
  const windowEnd = minutesToUtc(endStr, DAILY_HORIZON - 1, timezone); // 23:59 local

  let rule: RRule;
  try {
    const options = RRule.parseString(rruleBody(rrule));
    options.dtstart = minutesToUtc(startStr, dtstartMinutes, timezone);
    rule = new RRule(options);
  } catch {
    return [anchorDateStr];
  }

  // Expand across the window, then keep only working days so recurrence never
  // lands on a non-working day (where there's no schedulable window).
  const days = [
    ...new Set(
      rule
        .between(windowStart, windowEnd, true)
        .map((d) => localDateStr(d, timezone)),
    ),
  ]
    .filter(isWorkday)
    .filter(inRange);
  return days.length ? days : [anchorDateStr];
}
