import type { Session } from "@zenflow/shared";

/** A session's check-off state as the calendar shows it. */
export type CheckState = "open" | "done" | "skipped";

export function checkStateOf(session: {
  completedAt: string | null;
  skipped: boolean;
}): CheckState {
  if (session.completedAt) return "done";
  return session.skipped ? "skipped" : "open";
}

export interface TodaySummary {
  /** Sessions that were not skipped. */
  total: number;
  done: number;
  /** Planned minutes across the sessions that were not skipped. */
  plannedMinutes: number;
  /** The first open session that has not started yet, or `null`. */
  nextUp: { id: string; title: string; startISO: string } | null;
}

/** Counts for the Today card. Skipped sessions drop out of both totals. */
export function summarizeToday(sessions: Session[], now: Date): TodaySummary {
  let total = 0;
  let done = 0;
  let plannedMinutes = 0;
  let nextUp: TodaySummary["nextUp"] = null;
  const counted = sessions
    .filter((s) => !s.skipped)
    .sort((a, b) =>
      (a.scheduledStartTime ?? "").localeCompare(b.scheduledStartTime ?? ""),
    );
  for (const s of counted) {
    total += 1;
    plannedMinutes += s.durationMinutes;
    if (s.completedAt) {
      done += 1;
      continue;
    }
    const start = s.scheduledStartTime;
    if (!nextUp && start && new Date(start).getTime() >= now.getTime()) {
      nextUp = { id: s.id, title: s.title, startISO: start };
    }
  }
  return { total, done, plannedMinutes, nextUp };
}

/** Planned hours with one decimal at most: 270 becomes "4.5", 120 becomes "2". */
export function formatHours(minutes: number): string {
  return String(Math.round((minutes / 60) * 10) / 10);
}

/** Which greeting fits the hour of day (0 to 23, user timezone). */
export function greetingKey(hour: number): "morning" | "afternoon" | "evening" {
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}
