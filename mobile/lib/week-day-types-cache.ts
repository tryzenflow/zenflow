import { listSessions } from "@/api/tasks";
import { dateKey, weekStart } from "@/lib/week-date-math";
import { sessionTypesByDay } from "@/lib/week-day-types";
import type { SessionType } from "@zenflow/shared";

export type DayTypes = Map<string, SessionType[]>;

const cache = new Map<string, DayTypes>();

/** Cache key for the week containing `date` (a tz wall-clock date). */
export function weekTypesKey(date: Date, tz: string): string {
  return `${tz}|${dateKey(weekStart(date))}`;
}

export function getCachedWeekTypes(key: string): DayTypes | undefined {
  return cache.get(key);
}

export function setCachedWeekTypes(key: string, types: DayTypes): void {
  cache.set(key, types);
}

/** Per-user data: dropped on sign-out / user switch. */
export function clearWeekTypesCache(): void {
  cache.clear();
}

/**
 * Fetch + cache the dot row for the week containing `date`. The calendar lands
 * on a week the user may never have opened after a create/edit; without this
 * the header shows no dots until its own fetch resolves. Never rejects.
 */
export async function warmWeekTypes(date: Date, tz: string): Promise<void> {
  try {
    const { sessions } = await listSessions("week", weekStart(date));
    cache.set(weekTypesKey(date, tz), sessionTypesByDay(sessions, tz));
  } catch {
    // The header fetches it itself.
  }
}
