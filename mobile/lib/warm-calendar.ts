import { listSessions } from "@/api/tasks";
import { useConnectivity } from "@/lib/connectivity";
import { fetchDaySessions, isDayCacheFresh } from "@/lib/session-cache";
import { dateKey } from "@/lib/week-date-math";
import { addDays, addMonths, format, startOfWeek } from "date-fns";

/**
 * Fill the offline cache: the previous, current and next month plus each day of
 * the current week, so the calendar and task details open without a network.
 * Day and month entries are separate cache keys (the screens read them
 * independently), so both are fetched. Entries still fresh are skipped; a
 * failure is ignored (the cache just stays as it was).
 */
export async function warmCalendar(now: Date = new Date()): Promise<void> {
  if (!useConnectivity.getState().online) return;
  const jobs: Promise<unknown>[] = [];
  const warm = (key: string, view: "day" | "week" | "month", date: Date) => {
    if (isDayCacheFresh(key)) return;
    jobs.push(
      fetchDaySessions(key, () =>
        listSessions(view, date).then((res) => res.sessions),
      ).catch(() => undefined),
    );
  };
  for (const offset of [0, 1, -1]) {
    const month = addMonths(now, offset);
    warm(`month:${format(month, "yyyy-MM")}`, "month", month);
  }
  const monday = startOfWeek(now, { weekStartsOn: 1 });
  for (const offset of [0, 1, -1]) {
    const weekMonday = addDays(monday, offset * 7);
    warm(`week:${dateKey(weekMonday)}`, "week", weekMonday);
  }
  for (let i = 0; i < 7; i++) {
    const day = addDays(monday, i);
    warm(format(day, "yyyy-MM-dd"), "day", day);
  }
  await Promise.all(jobs);
}
