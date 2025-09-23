import { BadRequestException } from "@nestjs/common";
import { CreateConstraintsDto } from "../dto/create-constraint.dto";
import { Interval } from "../interfaces/interval.interface";
import { minuteToTime } from "../../common/utils";

export const checkNoOverlap = (
  intervals: Interval[]
): [] | [Interval, Interval] => {
  const sortedIntervals = intervals.slice().sort((a, b) => a.start - b.start);
  for (let i = 1; i < sortedIntervals.length; i++) {
    if (sortedIntervals[i].start < sortedIntervals[i - 1].end) {
      return [sortedIntervals[i], sortedIntervals[i - 1]];
    }
  }
  return [];
};

export function validateConstraintsOverlaps(
  focusBlocks: CreateConstraintsDto["focusBlocks"]
) {
  const overlappingFocusBlocks = checkNoOverlap(focusBlocks);
  if (overlappingFocusBlocks.length === 2) {
    const start = `${minuteToTime(overlappingFocusBlocks[0].start)}-${minuteToTime(
      overlappingFocusBlocks[0].end
    )}`;
    const end = `${minuteToTime(overlappingFocusBlocks[1].start)}-${minuteToTime(
      overlappingFocusBlocks[1].end
    )}`;
    throw new BadRequestException({
      success: false,
      message: `Focus blocks have overlapping time ranges: ${start} and ${end}`,
      field: "focusBlocks",
    });
  }
}
