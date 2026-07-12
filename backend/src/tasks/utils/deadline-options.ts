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
 * The six deadline quick-action chip values (todo.md), each derived from
 * `horizon.ts`'s `endOfPeriod` ceiling math relative to `anchor` — the
 * single source of truth for the night-owl-wrap math shared with the
 * period-bound placement logic.
 */
export function deadlineOptions(
  anchor: string,
  user: User,
): DeadlineOptionsResponse {
  const tz = user.timezone;
  const work = { workStart: user.workStart, workEnd: user.workEnd };
  const anchorDate = new Date(anchor);
  const dateStr = localDateStr(anchorDate, tz);

  const today = endOfPeriod(anchorDate, "day", tz, work);

  // Tomorrow is explicitly "next calendar day's WORK-HOURS end" (todo.md) —
  // a different, more specific value than the "day ceiling" (midnight)
  // "Today" uses, so this reads `workWindowFor` directly rather than
  // `endOfPeriod`. Wrap-aware: a night-owl window's end already lands on
  // the following morning.
  const tomorrow = new Date(
    workWindowFor(addDaysStr(dateStr, 1), user.workStart, user.workEnd, tz).end,
  );

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
