import { overlapsAny, type Interval } from "./slot";

/**
 * Sync-conflict detection (issue #62 D) — pure. Given the fixed blocks a
 * timetable / exam / LMS sync just wrote and the user's own scheduled tasks,
 * returns the ids of the tasks now overlapping any of those blocks, sorted so
 * the same conflict set always yields the same list (stable dedupe key).
 */
export function findConflictingTaskIds(
  fixed: Interval[],
  tasks: { id: string; startMs: number; durationMinutes: number }[],
): string[] {
  if (fixed.length === 0) return [];
  return tasks
    .filter((t) =>
      overlapsAny(fixed, t.startMs, t.startMs + t.durationMinutes * 60_000),
    )
    .map((t) => t.id)
    .sort();
}

/** "X conflict(s)" wording used by the notification copy. */
export function conflictCountLabel(count: number): string {
  return `${count} conflict${count === 1 ? "" : "s"}`;
}
