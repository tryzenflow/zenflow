import type { DaySegment } from "@zenflow/shared";
import { type MinuteSpan, minuteSpanOf } from "./day-grid";
import type { BlockLayout } from "./overlap";

/**
 * Pure geometry for the Week grid (`components/calendar/week-grid.tsx`). RN-free
 * so it can be unit-tested (`lib/__tests__/week-grid-math.test.ts`).
 */

/** Horizontal inset (px) each block keeps from its column's edges. */
export const COLUMN_GUTTER = 2;

/** How far (px) each overlapping block is shifted right of the one under it. */
export const CASCADE_STEP = 7;
const MAX_CASCADE = 4;

/**
 * Left edge and width (px) of a block inside its day column. Overlapping
 * blocks stack like Day view: each later one sits on top, shifted a little
 * right, so a narrow week column keeps every block as wide as it can be.
 */
export function columnBlockFrame(
  layout: Pick<BlockLayout, "column">,
  columnWidth: number,
): { left: number; width: number } {
  const usable = Math.max(0, columnWidth - COLUMN_GUTTER * 2);
  const shift = Math.min(layout.column, MAX_CASCADE) * CASCADE_STEP;
  return {
    left: COLUMN_GUTTER + shift,
    width: Math.max(8, usable - shift),
  };
}

/**
 * Minute spans of every day in the week, for the shared night folds: a night
 * stays folded only when no day has an event in it.
 */
export function weekSpans(
  segmentsByDay: readonly (readonly DaySegment[])[],
  tz: string,
): MinuteSpan[] {
  return segmentsByDay.flat().map((s) => minuteSpanOf(s, tz));
}

/** Column width (px) for a grid `totalWidth` wide, with the time gutter removed. */
export function weekColumnWidth(totalWidth: number, gutterWidth: number): number {
  return Math.max(0, (totalWidth - gutterWidth) / 7);
}
