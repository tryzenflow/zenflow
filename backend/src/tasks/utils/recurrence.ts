import { RRule } from "rrule";
import type { ViewMode } from "@zenflow/shared";
import { minutesToUtc } from "../../common/utils";
import { DAILY_HORIZON } from "../../common/constants";
import { localDateStr } from "../../scheduler/slot";
import { viewDayRange } from "../../scheduler/horizon";

/**
 * Concrete occurrence days (YYYY-MM-DD in the user's tz) a recurring task
 * materializes into, given the view it was created from.
 *
 * The frontend emits a single FREQ rule bounded by UNTIL to the active
 * week/month. We anchor DTSTART to the *first day of that same window* (not the
 * day the user happened to click) so e.g. FREQ=DAILY across a week always
 * yields all seven days. Each returned day becomes its own persisted Task row
 * (same rrule + seriesId, distinct id), which the EDF engine then places.
 *
 * A non-recurring task (or Day view) collapses to the single anchor day.
 */
export function occurrenceDays(
  rrule: string,
  view: ViewMode,
  anchorDateStr: string,
  timezone: string,
  dtstartMinutes: number,
): string[] {
  if (!rrule || view === "day") return [anchorDateStr];

  const { startStr, endStr } = viewDayRange(view, anchorDateStr);
  const windowStart = minutesToUtc(startStr, 0, timezone);
  const windowEnd = minutesToUtc(endStr, DAILY_HORIZON - 1, timezone); // 23:59 local

  let rule: RRule;
  try {
    const body =
      rrule
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find((l) => /^RRULE[:;]/i.test(l))
        ?.replace(/^RRULE:/i, "") ?? rrule;
    const options = RRule.parseString(body);
    options.dtstart = minutesToUtc(startStr, dtstartMinutes, timezone);
    rule = new RRule(options);
  } catch {
    return [anchorDateStr];
  }

  const days = [
    ...new Set(
      rule.between(windowStart, windowEnd, true).map((d) => localDateStr(d, timezone)),
    ),
  ];
  return days.length ? days : [anchorDateStr];
}
