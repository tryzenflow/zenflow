import { listSessions } from "@/api/tasks";
import { fetchDaySessions } from "@/lib/session-cache";
import { dateFromKey, nearestDayWithTask } from "@/lib/nearest-day";
import { addMonths, format } from "date-fns";

export { dateFromKey, nearestDayWithTask };

/**
 * Searches `from`'s month and the months either side for the nearest day with
 * a task (see {@link nearestDayWithTask}). Months go through the shared day
 * cache under the same `month:` key `month-page.tsx` uses, so a month the user
 * already saw costs no request. `null` when those three months hold no task
 * (even if they hold a timetable), or the lookup fails.
 */
export async function findNearestTaskDate(
  from: Date,
  tz: string,
): Promise<Date | null> {
  try {
    const months = [-1, 0, 1].map((n) => addMonths(from, n));
    const lists = await Promise.all(
      months.map((month) =>
        fetchDaySessions(`month:${format(month, "yyyy-MM")}`, () =>
          listSessions("month", month).then((res) => res.sessions),
        ),
      ),
    );
    return nearestDayWithTask(lists.flat(), from, tz);
  } catch {
    return null;
  }
}
