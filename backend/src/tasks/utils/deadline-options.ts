import { DeadlineOptionsResponse } from "@zenflow/shared";
import { DAILY_HORIZON } from "../../common/constants";
import { minutesToUtc } from "../../common/utils";
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
 * The six deadline quick-action chip values: "Today" and "Tomorrow" are
 * end-of-day (23:59, `DAILY_HORIZON - 1`) on the current and next calendar
 * day respectively (avoiding the ambiguous midnight-of-day-boundary case);
 * the rest use `endOfPeriod` ceiling math relative to `anchor`.
 */
export function deadlineOptions(
  anchor: string,
  user: User,
): DeadlineOptionsResponse {
  const tz = user.timezone;
  const work = { workStart: user.workStart, workEnd: user.workEnd };
  const anchorDate = new Date(anchor);
  const dateStr = localDateStr(anchorDate, tz);

  // "Today" = today at 11:59 PM (end of the current calendar day)
  const today = minutesToUtc(dateStr, DAILY_HORIZON - 1, tz);

  // "Tomorrow" = tomorrow at 11:59 PM (end of the next calendar day)
  const tomorrow = minutesToUtc(addDaysStr(dateStr, 1), DAILY_HORIZON - 1, tz);

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
