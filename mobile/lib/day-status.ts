import type { DaySegment } from "@zenflow/shared";

/** What the day view says about "now" for today, derived from loaded blocks. */
export type DayStatus =
  | { kind: "next"; taskId: string; title: string; startISO: string }
  | { kind: "done" }
  | { kind: "none" };

/**
 * The next session still to start, or "done" once every block (do-not-disturb
 * aside) has ended, else "none" (empty day, or something is in progress with
 * nothing after it).
 */
export function deriveDayStatus(
  segments: readonly DaySegment[],
  nowMs: number,
): DayStatus {
  const real = segments.filter((s) => s.type !== "DND");
  if (real.length === 0) return { kind: "none" };
  const upcoming = real
    .filter((s) => !s.continued && new Date(s.start).getTime() > nowMs)
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())[0];
  if (upcoming) {
    return {
      kind: "next",
      taskId: upcoming.taskId,
      title: upcoming.title,
      startISO: upcoming.start,
    };
  }
  const allEnded = real.every((s) => new Date(s.end).getTime() <= nowMs);
  return allEnded ? { kind: "done" } : { kind: "none" };
}
