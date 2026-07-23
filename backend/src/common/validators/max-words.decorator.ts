import {
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
} from "class-validator";

/**
 * Validates that a string value contains at most `max` whitespace-separated
 * words. Unlike `@MaxLength`, this counts words, not characters.
 */
export function MaxWords(max: number, validationOptions?: ValidationOptions) {
  return function (object: Record<string, any>, propertyName: string) {
    registerDecorator({
      name: "maxWords",
      target: object.constructor,
      propertyName: propertyName,
      constraints: [max],
      options: validationOptions,
      validator: {
        validate(value: any, args: ValidationArguments) {
          if (typeof value !== "string") {
            return true; // Let @IsString handle type validation.
          }
          const wordCount = value.trim().split(/\s+/).filter(Boolean).length;
          const maxWords = args.constraints[0] as number;
          return wordCount <= maxWords;
        },
        defaultMessage(args: ValidationArguments) {
          const maxWords = args.constraints[0] as number;
          return `${args.property} must be at most ${maxWords} words`;
        },
      },
    });
  };
}
