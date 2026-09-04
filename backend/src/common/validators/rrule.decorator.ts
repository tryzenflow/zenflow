import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from "class-validator";
import { RRule } from "rrule";

/**
 * Passes when the value is a string that `rrule` can parse as an `RRULE:` line
 * (no `DTSTART`). Used for DND session recurrence.
 */
export function IsRRule(validationOptions?: ValidationOptions) {
  return function (object: Record<string, any>, propertyName: string) {
    registerDecorator({
      name: "isRRule",
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          if (typeof value !== "string" || value.length === 0) return false;
          try {
            RRule.parseString(value);
            return true;
          } catch {
            return false;
          }
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} must be a valid RFC 5545 RRULE string`;
        },
      },
    });
  };
}
