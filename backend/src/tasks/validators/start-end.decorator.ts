import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
  registerDecorator,
  ValidationOptions,
} from "class-validator";
import { TaskWindowDto } from "../dto/task-window.dto";
import { TIME_GRANULARITY } from "src/common/constants";

@ValidatorConstraint({ name: "IsEndTimeAfterStartTime", async: false })
export class IsEndTimeAfterStartTimeConstraint
  implements ValidatorConstraintInterface
{
  validate(end: number, args: ValidationArguments) {
    const object = args.object as TaskWindowDto;
    const start = object.start;
    return end >= start + TIME_GRANULARITY;
  }

  defaultMessage(args: ValidationArguments) {
    return `End timestamp must be greater than or equal to start timestamp by ${TIME_GRANULARITY} minutes`;
  }
}

export function IsEndTimeAfterStartTime(validationOptions?: ValidationOptions) {
  return function (object: TaskWindowDto, propertyName: string) {
    registerDecorator({
      name: "IsEndTimeAfterStartTime",
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      validator: IsEndTimeAfterStartTimeConstraint,
    });
  };
}
