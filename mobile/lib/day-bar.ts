import { zonedDate } from "@zenflow/core";
import type { Session, SessionType } from "@zenflow/shared";
import { addDays } from "date-fns";
import { dateKey } from "./week-date-math";

/** One stretch of a day bar: a session type over a span of the 24 hours. */
export interface BarSegment {
  kind: SessionType;
  /** Minutes from midnight. */
  start: number;
  end: number;
}

export interface DayBar {
  /** Distinct session types on the day, in first-seen order. */
  types: SessionType[];
  /** Non-overlapping stretches in time order, placed on a 24 hour track. */
  segments: BarSegment[];
}

function minutesOfDay(iso: string, tz: string): number {
  const d = zonedDate(iso, tz);
  return d.getHours() * 60 + d.getMinutes();
}

interface Span {
  type: SessionType;
  start: number;
  end: number;
}

/** A session's span on its start day, plus the carried-over tail on the next. */
function spansOf(
  session: Session,
  tz: string,
): { key: string; span: Span }[] {
  const startISO = session.scheduledStartTime as string;
  const day = zonedDate(startISO, tz);
  const start = minutesOfDay(startISO, tz);
  const total = start + Math.max(1, session.durationMinutes);
  const out = [
    {
      key: dateKey(day),
      span: { type: session.type, start, end: Math.min(1440, total) },
    },
  ];
  if (total > 1440) {
    out.push({
      key: dateKey(addDays(day, 1)),
      span: { type: session.type, start: 0, end: Math.min(1440, total - 1440) },
    });
  }
  return out;
}

function barOf(all: Span[]): DayBar {
  const spans = [...all].sort((a, b) => a.start - b.start || a.end - b.end);
  const types: SessionType[] = [];
  const segments: BarSegment[] = [];
  let cursor = 0;
  for (const span of spans) {
    if (!types.includes(span.type)) types.push(span.type);
    const from = Math.max(cursor, span.start);
    if (span.end <= from) continue;
    const last = segments[segments.length - 1];
    if (last && last.kind === span.type && last.end === from) last.end = span.end;
    else segments.push({ kind: span.type, start: from, end: span.end });
    cursor = span.end;
  }
  return { types, segments };
}

/**
 * The bar for one day's sessions on a 24 hour track: a segment per session at
 * its place in the day, tinted by type. Overlaps are drawn once and adjacent
 * stretches of one type merge. A session running past
 * midnight stops at midnight; `dayBarsByDay` carries the rest to the next day.
 */
export function buildDayBar(sessions: Session[], tz: string): DayBar {
  return barOf(
    sessions
      .filter((s) => s.scheduledStartTime)
      .map((s) => (spansOf(s, tz)[0] as { span: Span }).span),
  );
}

/** Bars per day for a set of sessions, keyed by `dateKey` of the user's day. */
export function dayBarsByDay(
  sessions: Session[],
  tz: string,
): Map<string, DayBar> {
  const byDay = new Map<string, Span[]>();
  for (const session of sessions) {
    if (!session.scheduledStartTime) continue;
    for (const { key, span } of spansOf(session, tz)) {
      const list = byDay.get(key);
      if (list) list.push(span);
      else byDay.set(key, [span]);
    }
  }
  const result = new Map<string, DayBar>();
  for (const [key, list] of byDay) result.set(key, barOf(list));
  return result;
}

export function sameDayBars(
  a: Map<string, DayBar>,
  b: Map<string, DayBar>,
): boolean {
  if (a.size !== b.size) return false;
  for (const [key, bar] of a) {
    const other = b.get(key);
    if (!other || JSON.stringify(other) !== JSON.stringify(bar)) return false;
  }
  return true;
}
