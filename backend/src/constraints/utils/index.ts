import { FocusBlock } from "../../../generated/prisma";
import { Interval } from "../interfaces/interval.interface";

/**
 * Return the union of all focus-block intervals.
 * The returned intervals represent the times "covered by focus blocks"
 * and therefore are the available hours.
 *
 * Overlapping or adjacent blocks are merged.
 */
export const getAvailableHours = (
  focusBlocks: Pick<FocusBlock, "start" | "end">[],
): Interval[] => {
  if (!focusBlocks || focusBlocks.length === 0) return [];

  // Filter out invalid blocks and sort by start ascending
  const cleaned = focusBlocks
    .filter((b) => b != null && isFinite(b.start) && isFinite(b.end))
    .map((b) => ({ start: Math.floor(b.start), end: Math.floor(b.end) }))
    .filter((b) => b.end > b.start)
    .sort((a, b) => a.start - b.start);

  if (cleaned.length === 0) return [];

  const merged: Interval[] = [];
  let currentStart = cleaned[0].start;
  let currentEnd = cleaned[0].end;

  for (let i = 1; i < cleaned.length; i++) {
    const block = cleaned[i];
    // Merge if overlapping or adjacent
    if (block.start <= currentEnd) {
      currentEnd = Math.max(currentEnd, block.end);
    } else {
      merged.push({ start: currentStart, end: currentEnd });
      currentStart = block.start;
      currentEnd = block.end;
    }
  }

  merged.push({ start: currentStart, end: currentEnd });
  return merged;
};
