import { RRule } from "rrule";
import type { ViewMode } from "@zenflow/shared";
import { minutesToUtc } from "../../common/utils";
import { DAILY_HORIZON } from "../../common/constants";
import { addDaysStr, localDateStr } from "../../scheduler/slot";
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

/** Mon-started offset of an RRULE weekday token: MO=0, TU=1 … SU=6. */
const WEEKDAY_OFFSET: Record<string, number> = {
  MO: 0,
  TU: 1,
  WE: 2,
  TH: 3,
  FR: 4,
  SA: 5,
  SU: 6,
};

/**
 * Month "weeks × weekdays": the frontend encodes the chosen calendar-row weeks
 * and weekdays as ordinal BYDAY tokens of a MONTHLY rule (e.g.
 * `BYDAY=1MO,1WE,3MO,3WE` ⇒ Mon & Wed of calendar-rows 1 and 3). Each `<N><DAY>`
 * token means the weekday `<DAY>` of Mon-started calendar-row `N` of the month
 * (week 1 = the row containing the 1st). The weekday letter is significant — it
 * selects that specific weekday, which may be a non-working day. Returns the
 * parsed pairs, or null when the rule isn't this shape.
 */
function monthWeekdayPairs(
  rrule: string,
  view: ViewMode,
): { ordinal: number; weekday: string }[] | null {
  if (view !== "month") return null;
  const body = rruleBody(rrule);
  if (!/FREQ=MONTHLY/i.test(body)) return null;
  const m = body.match(/BYDAY=([^;]+)/i);
  if (!m) return null;
  const pairs = m[1]
    .split(",")
    .map((tok) => tok.trim().match(/^(\d+)(MO|TU|WE|TH|FR|SA|SU)$/i))
    .filter((mm): mm is RegExpMatchArray => mm !== null)
    .map((mm) => ({
      ordinal: parseInt(mm[1], 10),
      weekday: mm[2].toUpperCase(),
    }))
    .filter((p) => p.ordinal > 0 && p.weekday in WEEKDAY_OFFSET);
  return pairs.length ? pairs : null;
}

/**
 * The concrete date of each chosen weekday-of-calendar-row that falls inside the
 * month. Calendar rows are Mon-started; row 1 is the row containing the 1st
 * (matching the frontend's `startOfWeek(startOfMonth)` picker), so its leading
 * days may belong to the previous month — those are dropped by the
 * `[monthStart, monthEnd]` bound. Non-working days are kept (the weekday was
 * chosen on purpose).
 */
function expandMonthWeekdays(
  pairs: { ordinal: number; weekday: string }[],
  monthStartStr: string,
  monthEndStr: string,
): string[] {
  const firstWeekMonday = weekStartStr(monthStartStr);
  const days = new Set<string>();
  for (const { ordinal, weekday } of pairs) {
    const ds = addDaysStr(
      firstWeekMonday,
      (ordinal - 1) * 7 + WEEKDAY_OFFSET[weekday],
    );
    if (ds < monthStartStr || ds > monthEndStr) continue;
    days.add(ds);
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
 * Recurrence honours the user's explicit weekday choice, including non-working
 * days. The week rule (`FREQ=WEEKLY;BYDAY=…`) materializes exactly the chosen
 * weekdays — a Saturday picked alongside Mon–Fri is kept. The month rule
 * (`FREQ=MONTHLY;BYDAY=<ordinal×weekday>`) materializes the chosen weekday(s) of
 * each chosen Mon-started calendar-row week. Neither path filters by workday;
 * the EDF engine places each occurrence within that day's work hours.
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
  const inRange = (ds: string) =>
    (!deadlineDateStr || ds <= deadlineDateStr) &&
    (!floorDateStr || ds >= floorDateStr);

  // Month "weeks × weekdays" → the chosen weekday(s) of each chosen week.
  const weekdayPairs = monthWeekdayPairs(rrule, view);
  if (weekdayPairs) {
    const days = expandMonthWeekdays(weekdayPairs, startStr, endStr).filter(
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

  // Expand across the window. The BYDAY already encodes the user's explicit
  // weekday choice (which may include non-working days), so we don't filter by
  // workday — only by the deadline/floor range.
  const days = [
    ...new Set(
      rule
        .between(windowStart, windowEnd, true)
        .map((d) => localDateStr(d, timezone)),
    ),
  ].filter(inRange);
  return days.length ? days : [anchorDateStr];
}
