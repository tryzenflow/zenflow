import { FocusBlock } from "../../../generated/prisma";
import { Interval } from "../interfaces/interval.interface";

export const getAvailableHours = (
  focusBlocks: Pick<FocusBlock, "start" | "end">[]
): Interval[] => {
  if (focusBlocks.length === 0) return [];

  const sorted = [...focusBlocks].sort((a, b) => a.start - b.start);

  const intervals: Interval[] = [];
  let start = sorted[0].start;
  let end = sorted[0].end;

  for (let i = 1; i < sorted.length; i++) {
    const block = sorted[i];
    if (block.start === end) {
      end = block.end;
    } else {
      intervals.push({ start, end });
      start = block.start;
      end = block.end;
    }
  }

  intervals.push({ start, end });

  return intervals;
};
