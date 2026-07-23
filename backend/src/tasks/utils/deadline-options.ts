import { DeadlineOptionsResponse } from "@zenflow/shared";
import { DAILY_HORIZON, TIME_GRANULARITY } from "../../common/constants";
import { minutesToUtc, utcToMinutes } from "../../common/utils";
import {
  endOfPeriod,
  weekStartStr,
  monthRange,
} from "../../scheduler/utils/horizon";
import {
  localDateStr,
  workWindowFor,
  addDaysStr,
} from "../../scheduler/utils/slot";
import { User } from "../../../generated/prisma";

/**
 * The six deadline quick-action chip values: "Today" is a few hours from now
 * (the anchor's time-of-day plus 3 hours, rounded up to the next 15-minute
 * grid boundary, clamped to the last on-grid slot of the anchor's calendar
 * day so it never rolls into tomorrow); "Tomorrow" is the start (00:00) of
 * the next calendar day; the rest use `endOfPeriod` ceiling math relative to
 * `anchor`. Every returned instant lands on the 15-minute grid.
 */
export function deadlineOptions(
  anchor: string,
  user: User,
): DeadlineOptionsResponse {
  const tz = user.timezone;
  const work = { workStart: user.workStart, workEnd: user.workEnd };
  const anchorDate = new Date(anchor);
  const dateStr = localDateStr(anchorDate, tz);

  // "Today" = a few hours from now (anchor time-of-day + 3h, rounded up to
  // the 15-minute grid, clamped to stay on the anchor's calendar day)
  const anchorMinutes = utcToMinutes(anchorDate, tz);
  const todayMinutesRaw =
    Math.ceil((anchorMinutes + 180) / TIME_GRANULARITY) * TIME_GRANULARITY;
  const todayMinutes = Math.min(
    todayMinutesRaw,
    DAILY_HORIZON - TIME_GRANULARITY,
  );
  const today = minutesToUtc(dateStr, todayMinutes, tz);

  // "Tomorrow" = start (00:00) of the next calendar day
  const tomorrow = minutesToUtc(addDaysStr(dateStr, 1), 0, tz);

  const thisWeek = endOfPeriod(anchorDate, "week", tz, work);

  const nextWeekAnchor = minutesToUtc(
    addDaysStr(weekStartStr(dateStr), 7),
    0,
    tz,
  );
  const nextWeek = endOfPeriod(nextWeekAnchor, "week", tz, work);

  const thisMonth = endOfPeriod(anchorDate, "month", tz, work);

  const { startStr: monthStart } = monthRange(dateStr);
  const [y, m] = monthStart.split("-").map(Number);
  const nextMonthStr =
    m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  const nextMonthAnchor = minutesToUtc(nextMonthStr, 0, tz);
  const noRush = endOfPeriod(nextMonthAnchor, "month", tz, work);

  return {
    today: today.toISOString(),
    tomorrow: tomorrow.toISOString(),
    thisWeek: thisWeek.toISOString(),
    nextWeek: nextWeek.toISOString(),
    thisMonth: thisMonth.toISOString(),
    noRush: noRush.toISOString(),
  };
}
