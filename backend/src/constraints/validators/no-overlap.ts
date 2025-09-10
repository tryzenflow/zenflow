import { BadRequestException } from "@nestjs/common";
import { CreateConstraintsDto } from "../dto/create-constraints.dto";
import { Interval } from "../interfaces/interval.interface";
import { TIME_REGEX } from "../../common/constants";
import { minuteToTime } from "../utils";

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
  availableHours: CreateConstraintsDto["availableHours"],
  energyBlocks: CreateConstraintsDto["energyBlocks"]
) {
  const overlappingAvailableHours = checkNoOverlap(availableHours);
  if (overlappingAvailableHours.length === 2) {
    const start = `${minuteToTime(overlappingAvailableHours[0].start)}-${minuteToTime(
      overlappingAvailableHours[0].end
    )}`;
    const end = `${minuteToTime(overlappingAvailableHours[1].start)}-${minuteToTime(
      overlappingAvailableHours[1].end
    )}`;
    throw new BadRequestException({
      success: false,
      message: `Available hours have overlapping time ranges: ${start} and ${end}`,
      field: "availableHours",
    });
  }

  const overlappingEnergyBlocks = checkNoOverlap(energyBlocks);
  if (overlappingEnergyBlocks.length === 2) {
    const start = `${minuteToTime(overlappingEnergyBlocks[0].start)}-${minuteToTime(
      overlappingEnergyBlocks[0].end
    )}`;
    const end = `${minuteToTime(overlappingEnergyBlocks[1].start)}-${minuteToTime(
      overlappingEnergyBlocks[1].end
    )}`;
    throw new BadRequestException({
      success: false,
      message: `Energy blocks have overlapping time ranges: ${start} and ${end}`,
      field: "energyBlocks",
    });
  }
}
