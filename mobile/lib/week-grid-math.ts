import type { DaySegment } from "@zenflow/shared";
import { type MinuteSpan, minuteSpanOf } from "./day-grid";
import type { BlockLayout } from "./overlap";

/**
 * Pure geometry for the Week grid (`components/calendar/week-grid.tsx`). RN-free
 * so it can be unit-tested (`lib/__tests__/week-grid-math.test.ts`).
 */

/** Horizontal inset (px) each block keeps from its column's edges. */
export const COLUMN_GUTTER = 2;

/**
 * Left edge and width (px) of a block inside its day column. Overlapping
 * blocks split the column evenly, so a narrow week column still shows every
 * block side by side.
 */
export function columnBlockFrame(
  layout: Pick<BlockLayout, "column" | "columns">,
  columnWidth: number,
): { left: number; width: number } {
  const columns = Math.max(1, layout.columns);
  const usable = Math.max(0, columnWidth - COLUMN_GUTTER * 2);
  const width = usable / columns;
  return { left: COLUMN_GUTTER + layout.column * width, width };
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
