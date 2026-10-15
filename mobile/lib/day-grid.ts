/**
 * Vertical day grid: hour height, the 24 hour band and the single
 * y <-> minute mapping every calendar gesture and layout uses.
 *
 * Pure. The mapping functions carry `'worklet'` so drag, resize and tap code on
 * the UI thread runs the same maths as the JS layout. Shared by the day grid
 * and the week grid (#240).
 */
import { DAILY_HORIZON } from "@zenflow/core";
import type { DaySegment } from "@zenflow/shared";
import { toZonedTime } from "date-fns-tz";

export const HOUR_HEIGHT_DEFAULT = 56;
export const HOUR_HEIGHT_MIN = 36;
export const HOUR_HEIGHT_MAX = 160;
/** Px above a target minute the grid scrolls to, so it sits near the top. */
const SCROLL_LEAD_PX = 120;
/** Anchor for an empty day that is not today. */
const DEFAULT_ANCHOR_MIN = 8 * 60;

export interface MinuteSpan {
  startMin: number;
  endMin: number;
}

export interface Band {
  startMin: number;
  endMin: number;
  top: number;
  height: number;
}

export interface DayGrid {
  hourHeight: number;
  /** Total content height (px), bottom of the last band. */
  height: number;
  bands: Band[];
}

export function clampHourHeight(hourHeight: number): number {
  return Math.min(HOUR_HEIGHT_MAX, Math.max(HOUR_HEIGHT_MIN, hourHeight));
}

/** Lays out the whole day as one band of 24 hours at `hourHeight`. */
export function buildDayGrid(hourHeight: number): DayGrid {
  const height = (DAILY_HORIZON / 60) * hourHeight;
  return {
    hourHeight,
    height,
    bands: [{ startMin: 0, endMin: DAILY_HORIZON, top: 0, height }],
  };
}

/** Content height for a live hour height during a pinch, before the grid commits. */
export function gridHeightFor(hourHeight: number): number {
  "worklet";
  return (DAILY_HORIZON / 60) * hourHeight;
}

/** Minute span of a segment on the wall clock of `tz`, as the fold maths reads it. */
export function minuteSpanOf(segment: DaySegment, tz: string): MinuteSpan {
  const start = toZonedTime(new Date(segment.start), tz);
  const end = toZonedTime(new Date(segment.end), tz);
  const startMin = start.getHours() * 60 + start.getMinutes();
  const rawEnd = end.getHours() * 60 + end.getMinutes();
  return {
    startMin,
    endMin: segment.continues || rawEnd === 0 ? DAILY_HORIZON : rawEnd,
  };
}

/** Band containing a minute of day (the band whose start is <= min < end). */
export function bandAt(grid: DayGrid, min: number): Band | undefined {
  return grid.bands.find((b) => min >= b.startMin && min < b.endMin);
}

/** Minute of day to y (px). Monotonic; linear inside each band. */
export function minToY(grid: DayGrid, min: number): number {
  "worklet";
  const m = Math.min(DAILY_HORIZON, Math.max(0, min));
  for (const b of grid.bands) {
    if (m <= b.endMin) {
      return b.top + ((m - b.startMin) / (b.endMin - b.startMin)) * b.height;
    }
  }
  return grid.height;
}

/** y (px) to minute of day (fractional). Exact inverse of {@link minToY}. */
export function yToMin(grid: DayGrid, y: number): number {
  "worklet";
  const v = Math.min(grid.height, Math.max(0, y));
  for (const b of grid.bands) {
    if (v <= b.top + b.height) {
      return b.startMin + ((v - b.top) / b.height) * (b.endMin - b.startMin);
    }
  }
  return DAILY_HORIZON;
}

/**
 * Minute a block lands on after moving `dyPx` from `startMin`, before snapping.
 * Drag uses this instead of converting px to minutes on its own.
 */
export function dragTargetMin(
  grid: DayGrid,
  startMin: number,
  dyPx: number,
): number {
  "worklet";
  return yToMin(grid, minToY(grid, startMin) + dyPx);
}

/** Minutes of every hour line and gutter label. */
export function visibleHourMinutes(grid: DayGrid): number[] {
  void grid;
  return Array.from({ length: 24 }, (_, h) => h * 60);
}

/** Content tier of a block by its pixel height. */
export type BlockTier = "title" | "time" | "full";

export function blockTier(heightPx: number): BlockTier {
  if (heightPx < 24) return "title";
  if (heightPx < 44) return "time";
  return "full";
}

/** The minute to scroll to on open: now on today, else the first event. */
export function scrollAnchorMin(opts: {
  isToday: boolean;
  nowMin: number;
  firstEventMin: number | null;
  /** Anchor for an empty day; defaults to 8:00. */
  emptyMin?: number;
}): number {
  if (opts.isToday) return opts.nowMin;
  return opts.firstEventMin ?? opts.emptyMin ?? DEFAULT_ANCHOR_MIN;
}

/** Scroll offset (px) that puts `min` near the top of the viewport. */
export function scrollYForMin(grid: DayGrid, min: number): number {
  return Math.max(0, minToY(grid, min) - SCROLL_LEAD_PX);
}
