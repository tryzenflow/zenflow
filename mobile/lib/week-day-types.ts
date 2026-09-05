import { zonedDate } from "@zenflow/core";
import type { Session, SessionType } from "@zenflow/shared";
import { dateKey } from "./week-date-math";

/**
 * Reduces a week's sessions (`GET /sessions?view=week`, see
 * `api/tasks.ts`'s `listSessions`) into the distinct {@link SessionType}s
 * scheduled on each day, keyed by `dateKey` — what the week header's per-day
 * dot row (`components/calendar/week-header.tsx`) renders. `tz` converts each
 * `scheduledStartTime` instant into the user's wall-clock day, same as every
 * other day-grouping in the app (`zonedDate`, never a bare `new Date()`).
 *
 * Unscheduled sessions (`scheduledStartTime: null` — a `TASK` the engine
 * hasn't placed yet) contribute no dot. A day with three `TASK` sittings
 * still yields a single `"TASK"` entry — dedupe is by type, not by session.
 */
export function sessionTypesByDay(
  sessions: Session[],
  tz: string,
): Map<string, SessionType[]> {
  const byDay = new Map<string, Set<SessionType>>();
  for (const session of sessions) {
    if (!session.scheduledStartTime) continue;
    const key = dateKey(zonedDate(session.scheduledStartTime, tz));
    const types = byDay.get(key);
    if (types) {
      types.add(session.type);
    } else {
      byDay.set(key, new Set([session.type]));
    }
  }
  const result = new Map<string, SessionType[]>();
  for (const [key, types] of byDay) {
    result.set(key, Array.from(types));
  }
  return result;
}
