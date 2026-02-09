import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
  registerDecorator,
  ValidationOptions,
} from "class-validator";
import { CreateUserPreferenceDto } from "../dto/create-pref.dto";
import { TIME_GRANULARITY } from "../../common/constants";
import { Interval } from "../../common/interfaces/interval.interface";

export const checkNoOverlap = (
  intervals: Interval[],
): [] | [Interval, Interval] => {
  const sortedIntervals = intervals.slice().sort((a, b) => a.start - b.start);
  for (let i = 1; i < sortedIntervals.length; i++) {
    if (sortedIntervals[i].start < sortedIntervals[i - 1].end) {
      return [sortedIntervals[i], sortedIntervals[i - 1]];
    }
  }
  return [];
};

@ValidatorConstraint({ name: "NoOverlap", async: false })
export class NoOverlapConstraint implements ValidatorConstraintInterface {
  validate(
    energyZones: CreateUserPreferenceDto["energyZones"],
    args: ValidationArguments,
  ) {
    const intervals = energyZones.map((block) => ({
      start: block.start,
      end: block.end,
    }));
    const overlaps = checkNoOverlap(intervals);
    return overlaps.length === 0;
  }

  defaultMessage(args: ValidationArguments) {
    return `End timestamp must be greater than or equal to start timestamp by ${TIME_GRANULARITY} minutes`;
  }
}

export function NoOverlap(validationOptions?: ValidationOptions) {
  return function (object: CreateUserPreferenceDto, propertyName: string) {
    registerDecorator({
      name: "NoOverlap",
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      validator: NoOverlapConstraint,
    });
  };
}
