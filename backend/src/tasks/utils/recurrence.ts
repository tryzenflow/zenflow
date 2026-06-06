import { RRule } from "rrule";
import type { ViewMode } from "@zenflow/shared";
import { minutesToUtc } from "../../common/utils";
import { DAILY_HORIZON } from "../../common/constants";
import { addDaysStr, isoWeekday, localDateStr } from "../../scheduler/slot";
import { viewDayRange, weekStartStr } from "../../scheduler/horizon";

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
 * Month "specific weeks": the frontend encodes the chosen week-of-month
 * ordinals as the BYDAY prefixes of a MONTHLY rule (e.g. `BYDAY=1MO,3MO` ⇒
 * weeks 1 and 3). The weekday letter is only a carrier — the real intent is
 * "every working day of those weeks". Returns the ordinals, or null when the
 * rule isn't this shape.
 */
function monthWeekOrdinals(rrule: string, view: ViewMode): number[] | null {
  if (view !== "month") return null;
  const body = rruleBody(rrule);
  if (!/FREQ=MONTHLY/i.test(body)) return null;
  const m = body.match(/BYDAY=([^;]+)/i);
  if (!m) return null;
  const ordinals = m[1]
    .split(",")
    .map((tok) => tok.trim().match(/^(-?\d+)/))
    .map((mm) => (mm ? parseInt(mm[1], 10) : NaN))
    .filter((n) => Number.isFinite(n) && n > 0);
  return ordinals.length ? [...new Set(ordinals)] : null;
}

/**
 * Every working day of each chosen Monday-started week of the month that falls
 * inside the month. Week 1 is the week containing the 1st (matching the
 * frontend's `startOfWeek(startOfMonth)` picker), so its leading days may belong
 * to the previous month — those are dropped by the `[monthStart, monthEnd]`
 * bound.
 */
function expandMonthWeeks(
  ordinals: number[],
  monthStartStr: string,
  monthEndStr: string,
  isWorkday: (ds: string) => boolean,
): string[] {
  const firstWeekMonday = weekStartStr(monthStartStr);
  const days = new Set<string>();
  for (const n of ordinals) {
    const weekMonday = addDaysStr(firstWeekMonday, (n - 1) * 7);
    for (let i = 0; i < 7; i++) {
      const ds = addDaysStr(weekMonday, i);
      if (ds < monthStartStr || ds > monthEndStr) continue;
      if (isWorkday(ds)) days.add(ds);
    }
  }
  return [...days].sort();
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
 * working days. "Every X days" therefore skips non-working days, and the month
 * "specific weeks" mode expands to every working day of the chosen weeks.
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

  // Month "specific weeks" → every working day of each chosen week.
  const weekOrdinals = monthWeekOrdinals(rrule, view);
  if (weekOrdinals) {
    const days = expandMonthWeeks(weekOrdinals, startStr, endStr, isWorkday).filter(
      inRange,
    );
    return days.length ? days : [anchorDateStr];
  }

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
