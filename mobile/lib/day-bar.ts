import { zonedDate } from "@zenflow/core";
import type { Session, SessionType } from "@zenflow/shared";
import { dateKey } from "./week-date-math";

/** One stretch of a day bar: a session type, or `gap` for free time. */
export interface BarSegment {
  kind: SessionType | "gap";
  /** Minutes the stretch covers, used as the flex weight. */
  flex: number;
}

export interface DayBar {
  /** Distinct session types on the day, in first-seen order. */
  types: SessionType[];
  /** Stretches from the first session start to the last session end. */
  segments: BarSegment[];
}

/** Gaps shorter than this are not drawn: they only add slivers. */
const MIN_GAP_MIN = 30;

function minutesOfDay(iso: string, tz: string): number {
  const d = zonedDate(iso, tz);
  return d.getHours() * 60 + d.getMinutes();
}

/**
 * The bar for one day's sessions: a segment per session in time order, tinted
 * by type, with gray `gap` segments for free time between them. Overlaps are
 * drawn once, adjacent stretches of one type merge, and a session running past
 * midnight stops at midnight.
 */
export function buildDayBar(sessions: Session[], tz: string): DayBar {
  const spans = sessions
    .filter((s) => s.scheduledStartTime)
    .map((s) => {
      const start = minutesOfDay(s.scheduledStartTime as string, tz);
      return {
        type: s.type,
        start,
        end: Math.min(1440, start + Math.max(1, s.durationMinutes)),
      };
    })
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const types: SessionType[] = [];
  const segments: BarSegment[] = [];
  const push = (kind: BarSegment["kind"], flex: number) => {
    if (flex <= 0) return;
    const last = segments[segments.length - 1];
    if (last && last.kind === kind) last.flex += flex;
    else segments.push({ kind, flex });
  };

  let cursor = spans[0]?.start ?? 0;
  for (const span of spans) {
    if (!types.includes(span.type)) types.push(span.type);
    const gap = span.start - cursor;
    if (gap >= MIN_GAP_MIN) push("gap", gap);
    const from = Math.max(cursor, span.start);
    if (span.end > from) {
      push(span.type, span.end - from);
      cursor = span.end;
    }
  }
  return { types, segments };
}

/** Bars per day for a set of sessions, keyed by `dateKey` of the user's day. */
export function dayBarsByDay(
  sessions: Session[],
  tz: string,
): Map<string, DayBar> {
  const byDay = new Map<string, Session[]>();
  for (const session of sessions) {
    if (!session.scheduledStartTime) continue;
    const key = dateKey(zonedDate(session.scheduledStartTime, tz));
    const list = byDay.get(key);
    if (list) list.push(session);
    else byDay.set(key, [session]);
  }
  const result = new Map<string, DayBar>();
  for (const [key, list] of byDay) result.set(key, buildDayBar(list, tz));
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
