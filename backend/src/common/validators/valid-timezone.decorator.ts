import {
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
} from "class-validator";

export function IsValidTimezone(validationOptions?: ValidationOptions) {
  return function (object: Record<string, any>, propertyName: string) {
    registerDecorator({
      name: "isValidTimezone",
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      validator: {
        validate(value: any, args: ValidationArguments) {
          if (typeof value !== "string") {
            return false; // Not a string, so not a valid IANA name
          }
          try {
            // Attempt to create a DateTimeFormat object with the value
            // This will throw a RangeError if the timezone name is invalid
            new Intl.DateTimeFormat(undefined, { timeZone: value });
            return true;
          } catch (e) {
            if (e instanceof RangeError) {
              return false;
            }
            throw e; // Re-throw other errors
          }
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} must be a valid IANA timezone name (e.g., 'America/New_York')`;
        },
      },
    });
  };
}
