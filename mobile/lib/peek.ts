import { addDays, startOfDay } from "date-fns";
import { zonedWallClockToUtc } from "@zenflow/core";
import type { DaySegment, SessionCardState } from "@zenflow/shared";

/** One session's slice of a day shown in a week pager's next-day peek strip. */
export interface PeekBlock {
  /** Segment key — unique within the day (task id, tail gets a suffix). */
  key: string;
  state: SessionCardState;
  /** Minutes into the day (0-1440) the block starts. */
  startMin: number;
  /** Length in minutes, clamped to the day (min 15 so slivers stay visible). */
  durationMin: number;
}

export const DAY_MINUTES = 24 * 60;

/** Map a day's segments to mini-day blocks positioned by wall-clock time. */
export function peekBlocksFromSegments(
  segments: DaySegment[],
  day: Date,
  tz: string,
): PeekBlock[] {
  const dayStartMs = zonedWallClockToUtc(startOfDay(day), tz).getTime();
  const dayEndMs = zonedWallClockToUtc(startOfDay(addDays(day, 1)), tz).getTime();
  return segments.map((segment) => {
    // Defensive clamp — `eventsForDay` already clamps, but a raw cross-midnight
    // interval must never yield a negative offset.
    const startMs = Math.max(new Date(segment.start).getTime(), dayStartMs);
    const endMs = Math.min(new Date(segment.end).getTime(), dayEndMs);
    return {
      key: segment.segmentId,
      state: segment.state,
      startMin: Math.round((startMs - dayStartMs) / 60_000),
      durationMin: Math.max(15, Math.round((endMs - startMs) / 60_000)),
    };
  });
}
