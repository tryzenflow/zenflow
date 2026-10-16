import { splitZoned, zonedDate } from "@zenflow/core";
import type { Session, SessionSearchDirection } from "@zenflow/shared";
import { addMinutes } from "date-fns";
import { format } from "./i18n";

export interface DayGroup {
  /** `yyyy-MM-dd` in the user's timezone. */
  date: string;
  sessions: Session[];
}

export type SearchListRow =
  | { kind: "day"; key: string; date: string }
  | { kind: "session"; key: string; session: Session };

function startMs(session: Session): number {
  return new Date(session.scheduledStartTime ?? 0).getTime();
}

/**
 * Group sessions by their calendar day in `tz`, ascending. Sessions without a
 * start time are skipped.
 */
export function groupSessionsByDay(sessions: Session[], tz: string): DayGroup[] {
  const groups: DayGroup[] = [];
  const scheduled = sessions
    .filter((s) => s.scheduledStartTime != null)
    .sort((a, b) => startMs(a) - startMs(b));
  for (const session of scheduled) {
    const date = splitZoned(session.scheduledStartTime as string, tz).date;
    const last = groups[groups.length - 1];
    if (last && last.date === date) last.sessions.push(session);
    else groups.push({ date, sessions: [session] });
  }
  return groups;
}

/** Flatten day groups into list rows: one header per day, then its sessions. */
export function flattenDayGroups(groups: DayGroup[]): SearchListRow[] {
  const rows: SearchListRow[] = [];
  for (const group of groups) {
    rows.push({ kind: "day", key: `day:${group.date}`, date: group.date });
    for (const session of group.sessions) {
      rows.push({ kind: "session", key: `session:${session.id}`, session });
    }
  }
  return rows;
}

/**
 * Add a page to the list: `forward` pages go after the current rows, `backward`
 * pages go before them. A session already present keeps its first position.
 */
export function mergeSearchPage(
  current: Session[],
  page: Session[],
  direction: SessionSearchDirection,
): Session[] {
  const combined = direction === "backward" ? [...page, ...current] : [...current, ...page];
  const seen = new Set<string>();
  return combined.filter((session) => {
    if (seen.has(session.id)) return false;
    seen.add(session.id);
    return true;
  });
}

/** Day header label, e.g. `Thu, 15 Oct 2026`. */
export function dayLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return format(new Date(y, m - 1, d), "EEE, d MMM yyyy");
}

/** Start and end of a session in `tz`, e.g. `09:00 – 10:30`. */
export function sessionTimeRange(session: Session, tz: string): string {
  const start = zonedDate(session.scheduledStartTime ?? new Date(0).toISOString(), tz);
  const end = addMinutes(start, session.durationMinutes);
  return `${format(start, "HH:mm")} – ${format(end, "HH:mm")}`;
}
