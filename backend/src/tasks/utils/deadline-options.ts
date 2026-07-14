import { DeadlineOptionsResponse } from "@zenflow/shared";
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
 * midnight of the next two calendar days (avoiding 15-min grid); the rest
 * use `endOfPeriod` ceiling math relative to `anchor`.
 */
export function deadlineOptions(
  anchor: string,
  user: User,
): DeadlineOptionsResponse {
  const tz = user.timezone;
  const work = { workStart: user.workStart, workEnd: user.workEnd };
  const anchorDate = new Date(anchor);
  const dateStr = localDateStr(anchorDate, tz);

  // "Today" = tomorrow at 12:00 AM (midnight start of next day)
  const today = minutesToUtc(addDaysStr(dateStr, 1), 0, tz);

  // "Tomorrow" = day after tomorrow at 12:00 AM
  const tomorrow = minutesToUtc(addDaysStr(dateStr, 2), 0, tz);

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
