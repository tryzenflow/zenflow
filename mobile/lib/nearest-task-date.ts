import { listSessions } from "@/api/tasks";
import { fetchDaySessions } from "@/lib/session-cache";
import { groupSessionsByDate } from "@/lib/month-date-math";
import { addMonths, format } from "date-fns";

const DAY_MS = 86_400_000;

/** Wall-clock midnight of a `'YYYY-MM-DD'` key, in the local fields (same
 * convention as `zonedDate`). */
export function dateFromKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function dayNumber(day: Date): number {
  return Math.round(Date.UTC(day.getFullYear(), day.getMonth(), day.getDate()) / DAY_MS);
}

/**
 * The day closest to `from` (ties go to the future) that has at least one
 * session, searching `from`'s month and the months either side. Months go
 * through the shared day cache under the same `month:` key `month-page.tsx`
 * uses, so a month the user already saw costs no request. `null` when those
 * three months are empty (or the lookup fails).
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
    const days = groupSessionsByDate(lists.flat(), tz);
    const origin = dayNumber(from);
    let best: { date: Date; dist: number; future: boolean } | null = null;
    for (const [key, group] of days) {
      if (group.length === 0) continue;
      const date = dateFromKey(key);
      const diff = dayNumber(date) - origin;
      const dist = Math.abs(diff);
      const future = diff >= 0;
      if (
        !best ||
        dist < best.dist ||
        (dist === best.dist && future && !best.future)
      ) {
        best = { date, dist, future };
      }
    }
    return best?.date ?? null;
  } catch {
    return null;
  }
}
