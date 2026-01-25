import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
  registerDecorator,
  ValidationOptions,
} from "class-validator";
import { TaskWindowDto } from "../dto/task-window.dto";
import { CreateTaskDto } from "../dto/create-task.dto";

@ValidatorConstraint({ name: "FixedWindow", async: false })
export class ValidFixedWindowConstraint
  implements ValidatorConstraintInterface
{
  validate(fixedWindow: TaskWindowDto, args: ValidationArguments) {
    const object = args.object as CreateTaskDto;
    const duration = object.duration;
    return duration == fixedWindow.end - fixedWindow.start;
  }

  defaultMessage(args: ValidationArguments) {
    return `Duration must be equal to the difference between fixed end and start timestamps`;
  }
}

export function ValidFixedWindow(validationOptions?: ValidationOptions) {
  return function (object: CreateTaskDto, propertyName: string) {
    registerDecorator({
      name: "ValidFixedWindow",
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      validator: ValidFixedWindowConstraint,
    });
  };
}
