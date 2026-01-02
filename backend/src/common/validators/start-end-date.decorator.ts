import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
  registerDecorator,
  ValidationOptions,
} from "class-validator";
import { DateRangeDto } from "../dto/date-range.dto";

@ValidatorConstraint({ name: "IsEndDateAfterStartDate", async: false })
export class IsEndDateAfterStartDateConstraint
  implements ValidatorConstraintInterface
{
  validate(end: string, args: ValidationArguments) {
    const object = args.object as DateRangeDto;
    const start = object.start;
    return end >= start;
  }

  defaultMessage(args: ValidationArguments) {
    return `End date must be greater than or equal to start date`;
  }
}

export function IsEndDateAfterStartDate(validationOptions?: ValidationOptions) {
  return function (object: DateRangeDto, propertyName: string) {
    registerDecorator({
      name: "IsEndDateAfterStartDate",
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      validator: IsEndDateAfterStartDateConstraint,
    });
  };
}
