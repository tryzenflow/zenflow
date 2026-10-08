import { groupSessionsByDate } from "./month-date-math";
import type { Session } from "@zenflow/shared";

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
 * *task*, from `sessions`. Lectures, assignments, exams and DND blocks are not
 * tasks: the Getting started steps (move, hold, drag) need something the user
 * can actually move, and pointing at a timetable entry would teach nothing.
 */
export function nearestDayWithTask(
  sessions: Session[],
  from: Date,
  tz: string,
): Date | null {
  const tasks = sessions.filter((s) => s.type === "TASK");
  const days = groupSessionsByDate(tasks, tz);
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
}
