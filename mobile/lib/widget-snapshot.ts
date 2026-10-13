import type { Session, SessionType } from "@zenflow/shared";
import { addDays, startOfWeek } from "date-fns";

export interface WidgetEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  type: SessionType;
  location: string | null;
}

// Mirrors the pending shared snapshot contract in issue #141.
export interface WidgetSnapshot {
  generatedAt: string;
  tz: string;
  language: "en" | "vi";
  events: WidgetEvent[];
  calendarEvents?: WidgetEvent[];
}

export async function loadWidgetHorizon(
  today: Date,
  listWeek: (monday: Date) => Promise<Session[]>,
): Promise<Session[]> {
  const monday = startOfWeek(today, { weekStartsOn: 1 });
  const weeks = await Promise.all([
    listWeek(monday),
    listWeek(addDays(monday, 7)),
  ]);
  return weeks.flat();
}

export function makeWidgetSnapshot(
  sessions: Session[],
  language: WidgetSnapshot["language"],
  tz: string,
  now = Date.now(),
  calendarSessions: Session[] = sessions,
): WidgetSnapshot {
  const seen = new Set<string>();
  const horizon = now + 7 * 24 * 60 * 60 * 1000;
  const events = sessions
    .filter((session) => {
      const start = session.scheduledStartTime;
      return (
        !!start &&
        Date.parse(start) < horizon &&
        Date.parse(start) + session.durationMinutes * 60_000 > now
      );
    })
    .filter((session) => {
      if (seen.has(session.id)) return false;
      seen.add(session.id);
      return true;
    })
    .map((session) => ({
      id: session.id,
      title: session.title,
      start: session.scheduledStartTime as string,
      end: new Date(
        Date.parse(session.scheduledStartTime as string) +
          session.durationMinutes * 60_000,
      ).toISOString(),
      type: session.type,
      location: session.location,
    }))
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));

  const calendarEvents = calendarSessions
    .filter((session) => !!session.scheduledStartTime)
    .filter((session, index, all) => all.findIndex((item) => item.id === session.id) === index)
    .map((session) => ({
      id: session.id,
      title: session.title,
      start: session.scheduledStartTime as string,
      end: new Date(Date.parse(session.scheduledStartTime as string) + session.durationMinutes * 60_000).toISOString(),
      type: session.type,
      location: session.location,
    }))
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  return { generatedAt: new Date(now).toISOString(), tz, language, events, calendarEvents };
}

export function nextWidgetEvent(
  snapshot: WidgetSnapshot | null,
  now = Date.now(),
): WidgetEvent | null {
  return snapshot?.events.find((event) => Date.parse(event.end) > now) ?? null;
}
