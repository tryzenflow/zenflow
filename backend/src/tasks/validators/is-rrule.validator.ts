import {
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
} from "class-validator";
import { rrulestr } from "rrule";

export function IsRRule(validationOptions?: ValidationOptions) {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      name: "isRRule",
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: any, _args: ValidationArguments) {
          if (typeof value !== "string") return false;
          try {
            // Use rrulestr to parse full iCalendar blocks (DTSTART + RRULE)
            rrulestr(value);
            const validFreqs = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"];
            if (!validFreqs.some((f) => value.includes(`FREQ=${f}`)))
              return false;
            return true;
          } catch (e) {
            return false;
          }
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} must be a valid RRule string (RFC 5545)`;
        },
      },
    });
  };
}
