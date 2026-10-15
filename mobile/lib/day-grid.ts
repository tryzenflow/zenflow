/**
 * Vertical day grid: hour height, the folded night bands and the single
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
/** Height (px) of a folded night band. */
export const FOLD_BAR_HEIGHT = 24;
/** Night is 00:00 to 07:00 and 23:00 to 24:00. */
export const NIGHT_EARLY_END_MIN = 7 * 60;
export const NIGHT_LATE_START_MIN = 23 * 60;
/** Px above a target minute the grid scrolls to, so it sits near the top. */
const SCROLL_LEAD_PX = 120;
/** Anchor for an empty day that is not today. */
const DEFAULT_ANCHOR_MIN = 8 * 60;

export type FoldId = "early" | "late";

export interface FoldRange {
  id: FoldId;
  startMin: number;
  endMin: number;
}

export const NIGHT_FOLDS: readonly FoldRange[] = [
  { id: "early", startMin: 0, endMin: NIGHT_EARLY_END_MIN },
  { id: "late", startMin: NIGHT_LATE_START_MIN, endMin: DAILY_HORIZON },
];

export interface MinuteSpan {
  startMin: number;
  endMin: number;
}

export interface Band {
  startMin: number;
  endMin: number;
  folded: boolean;
  /** Set only on folded night bands. */
  id?: FoldId;
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

/**
 * The night folds that stay collapsed: not unfolded by the user and no span
 * (event) overlapping them. An overlapping event always unfolds its night.
 */
export function foldedNightRanges(
  spans: readonly MinuteSpan[],
  unfolded: ReadonlySet<FoldId>,
): FoldRange[] {
  return NIGHT_FOLDS.filter(
    (fold) =>
      !unfolded.has(fold.id) &&
      !spans.some((s) => s.startMin < fold.endMin && s.endMin > fold.startMin),
  );
}

/** Lays out the day as unfolded hour bands and folded 24px bars, top to bottom. */
export function buildDayGrid(
  hourHeight: number,
  folded: readonly FoldRange[],
): DayGrid {
  const bands: Band[] = [];
  let y = 0;
  const push = (startMin: number, endMin: number, id?: FoldId) => {
    if (endMin <= startMin) return;
    const isFolded = id !== undefined;
    const height = isFolded
      ? FOLD_BAR_HEIGHT
      : ((endMin - startMin) / 60) * hourHeight;
    bands.push({ startMin, endMin, folded: isFolded, id, top: y, height });
    y += height;
  };
  let cursor = 0;
  const sorted = [...folded].sort((a, b) => a.startMin - b.startMin);
  for (const fold of sorted) {
    push(cursor, fold.startMin);
    push(fold.startMin, fold.endMin, fold.id);
    cursor = fold.endMin;
  }
  push(cursor, DAILY_HORIZON);
  return { hourHeight, height: y, bands };
}

/** Content height for a live hour height during a pinch, before the grid commits. */
export function gridHeightFor(
  hourHeight: number,
  folded: readonly FoldRange[],
): number {
  "worklet";
  let foldedMin = 0;
  for (const fold of folded) foldedMin += fold.endMin - fold.startMin;
  return (
    ((DAILY_HORIZON - foldedMin) / 60) * hourHeight +
    folded.length * FOLD_BAR_HEIGHT
  );
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

/** Hour lines and gutter labels for hours that are not inside a folded band. */
export function visibleHourMinutes(grid: DayGrid): number[] {
  const hours: number[] = [];
  for (let h = 0; h < 24; h++) {
    const band = bandAt(grid, h * 60);
    if (!band?.folded) hours.push(h * 60);
  }
  return hours;
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
}): number {
  if (opts.isToday) return opts.nowMin;
  return opts.firstEventMin ?? DEFAULT_ANCHOR_MIN;
}

/** Scroll offset (px) that puts `min` near the top of the viewport. */
export function scrollYForMin(grid: DayGrid, min: number): number {
  return Math.max(0, minToY(grid, min) - SCROLL_LEAD_PX);
}
