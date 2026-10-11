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
 * A task the user can still move: it has a start and that start is in the
 * future. Past tasks and ones already in progress (started, not over) are left
 * alone by the Getting started demos.
 */
export function isFutureTask(
  s: Pick<Session, "type" | "scheduledStartTime">,
  now: number = Date.now(),
): boolean {
  return (
    s.type === "TASK" &&
    !!s.scheduledStartTime &&
    Date.parse(s.scheduledStartTime) > now
  );
}

/**
 * The day closest to `from` (ties go to the future) that has at least one
 * *future task* (see {@link isFutureTask}), from `sessions`. Lectures, assignments, exams and DND blocks are not
 * tasks: the Getting started steps (move, hold, drag) need something the user
 * can actually move, and pointing at a timetable entry would teach nothing.
 */
export function nearestDayWithTask(
  sessions: Session[],
  from: Date,
  tz: string,
  now: number = Date.now(),
): Date | null {
  const tasks = sessions.filter((s) => isFutureTask(s, now));
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
