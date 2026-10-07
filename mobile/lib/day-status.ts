import type { DaySegment } from "@zenflow/shared";

/** What the day view says about "now" for today, derived from loaded blocks. */
export type DayStatus =
  | { kind: "next"; taskId: string; title: string; startISO: string }
  | { kind: "none" };

/**
 * The next session still to start (do-not-disturb aside), else "none" — an
 * empty day, or nothing left to start.
 */
export function deriveDayStatus(
  segments: readonly DaySegment[],
  nowMs: number,
): DayStatus {
  const upcoming = segments
    .filter(
      (s) =>
        s.type !== "DND" && !s.continued && new Date(s.start).getTime() > nowMs,
    )
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())[0];
  if (!upcoming) return { kind: "none" };
  return {
    kind: "next",
    taskId: upcoming.taskId,
    title: upcoming.title,
    startISO: upcoming.start,
  };
}
