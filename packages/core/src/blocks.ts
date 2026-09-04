import type { Session } from "@zenflow/shared";
import type { DaySegment, Event } from "@zenflow/shared";
import { deriveState } from "./task-card";
import { isSameDay, startOfDay } from "date-fns";
import { zonedDate, zonedWallClockToUtc } from "./tz";

/** Convert a scheduled task into a positioned calendar block (null if unplaced). */
export function taskToBlock(task: Session): Event | null {
  if (!task.scheduledStartTime) return null;
  const start = new Date(task.scheduledStartTime);
  const end = new Date(start.getTime() + task.durationMinutes * 60_000);
  return {
    id: task.id,
    taskId: task.id,
    title: task.title,
    start: start.toISOString(),
    end: end.toISOString(),
    type: task.type,
    tags: task.tags,
    state: deriveState(task),
  };
}

export function tasksToBlocks(tasks: Session[]): Event[] {
  return tasks
    .map((t) => taskToBlock(t))
    .filter((b): b is Event => b !== null);
}

/**
 * Clamp the events overlapping a given day column into {@link DaySegment}s,
 * splitting any task whose interval crosses midnight (in user-tz) into a head
 * segment on its start day and a leftover tail segment on the next day.
 *
 * `day` is a user-tz wall-clock Date (its local fields are the day in the
 * user's zone). The returned segments carry `start`/`end` clamped to that day's
 * 00:00–24:00 window so the grid positions them inside the 0–1440 minute range,
 * while `taskStart`/`taskEnd` preserve the real instants for mutations.
 */
export function eventsForDay(
  events: Event[],
  day: Date,
  tz: string,
): DaySegment[] {
  // The day's [00:00, 24:00) bounds as real UTC instants.
  const dayStartWall = startOfDay(day);
  const nextDayWall = new Date(dayStartWall);
  nextDayWall.setDate(nextDayWall.getDate() + 1);
  const dayStartMs = zonedWallClockToUtc(dayStartWall, tz).getTime();
  const dayEndMs = zonedWallClockToUtc(nextDayWall, tz).getTime();

  const segments: DaySegment[] = [];
  for (const ev of events) {
    const evStartMs = new Date(ev.start).getTime();
    const evEndMs = new Date(ev.end).getTime();
    // Skip events that don't intersect this day at all.
    if (evEndMs <= dayStartMs || evStartMs >= dayEndMs) continue;

    const clampedStartMs = Math.max(evStartMs, dayStartMs);
    // Clamp the end to the day boundary, but never below the start (an event
    // ending exactly at midnight belongs entirely to the previous day, already
    // excluded above).
    const clampedEndMs = Math.min(evEndMs, dayEndMs);

    const continued = evStartMs < dayStartMs; // tail spilling in from prior day
    const continues = evEndMs > dayEndMs; // head spilling out past midnight

    segments.push({
      ...ev,
      segmentId: continued ? `${ev.id}::tail` : ev.id,
      taskStart: ev.start,
      taskEnd: ev.end,
      start: new Date(clampedStartMs).toISOString(),
      end: new Date(clampedEndMs).toISOString(),
      continued: continued || undefined,
      continues: continues || undefined,
    });
  }
  return segments;
}

/** True when an event's user-tz interval crosses the given day's midnight. */
export function crossesMidnight(ev: Event, tz: string): boolean {
  return !isSameDay(zonedDate(ev.start, tz), zonedDate(ev.end, tz));
}
