import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsDivisibleBy,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateIf,
  ValidationArguments,
  ValidationOptions,
  registerDecorator,
} from "class-validator";
import { DAILY_HORIZON, TIME_GRANULARITY } from "src/common/constants";
import {
  VIEW_MODES,
  type CreateTaskInput,
  type ViewMode,
} from "@zenflow/shared";

/**
 * Cross-field validator: a fixed-task must supply enough information to derive
 * a positive duration. Either `durationMinutes` is present, or both `fixed`
 * (truthy) and `endTime` are present. Non-fixed tasks must always supply
 * `durationMinutes`.
 *
 * Applied as a class-level decorator so it can read both fields at once.
 */
function HasResolvableDuration(validationOptions?: ValidationOptions) {
  return function (target: object) {
    registerDecorator({
      name: "HasResolvableDuration",
      target: target as new (...args: unknown[]) => unknown,
      propertyName: "durationMinutes",
      options: {
        message:
          "durationMinutes is required, or (for fixed tasks) endTime must be provided so the duration can be derived",
        ...validationOptions,
      },
      validator: {
        validate(_value: unknown, args: ValidationArguments): boolean {
          const obj = args.object as CreateTaskDto;
          // durationMinutes present and valid (positive multiple of 15)
          if (
            typeof obj.durationMinutes === "number" &&
            obj.durationMinutes > 0
          )
            return true;
          // For fixed tasks: endTime can substitute — duration computed by service
          if (obj.fixed === true && typeof obj.endTime === "number")
            return true;
          return false;
        },
      },
    });
  };
}

@HasResolvableDuration()
export class CreateTaskDto implements CreateTaskInput {
  @IsString() title: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  note?: string | null;

  /**
   * Task duration in minutes (positive multiple of 15). Optional when
   * `fixed: true` and `endTime` is supplied — the server computes the duration,
   * handling cross-midnight spans (`startTime > endTime`).
   */
  @IsOptional()
  @IsInt()
  @Min(TIME_GRANULARITY)
  @IsDivisibleBy(TIME_GRANULARITY)
  durationMinutes?: number;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsISO8601()
  deadline?: string | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsBoolean()
  fixed?: boolean;

  /** Minutes from midnight (0–1439); only meaningful when {@link fixed} is true. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(DAILY_HORIZON - 1)
  startTime?: number;

  /**
   * Fixed-task end time in minutes from midnight (0–1439). Provide instead of
   * (or alongside) `durationMinutes` for fixed tasks. The server derives the
   * duration as `endTime + 1440 − startTime` when `endTime < startTime`
   * (cross-midnight), or `endTime − startTime` otherwise, then rounds to the
   * nearest 15-minute slot. Ignored for non-fixed tasks.
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(DAILY_HORIZON - 1)
  endTime?: number;

  /**
   * 'YYYY-MM-DD' day the task was created from, in the user's tz. For a fixed
   * task it's the exact anchor day; for a flexible task it's the earliest day
   * the engine may place it on. Defaults to today.
   */
  @IsOptional()
  @IsDateString()
  startDate?: string;

  /**
   * Calendar view active when scheduling. Drives the granularity of the
   * "next available period" overflow recovery option when the task can't be
   * placed before its deadline. Defaults to "day".
   */
  @IsOptional()
  @IsIn(VIEW_MODES)
  view?: ViewMode;

  /**
   * ISO-8601 inclusive start of the active calendar view window
   * (e.g. "2026-06-22T00:00:00.000Z"). When provided with viewEnd the backend
   * detects whether the task is placed outside the window and surfaces a
   * SchedulingOverflow in the response so the frontend can show the overflow
   * toast instead of silently accepting the out-of-view placement.
   */
  @IsOptional()
  @IsISO8601()
  viewStart?: string;

  /**
   * ISO-8601 exclusive end of the active calendar view window
   * (e.g. "2026-06-29T00:00:00.000Z" for the Mon 22 – Sun 28 Jun week).
   * See viewStart.
   */
  @IsOptional()
  @IsISO8601()
  viewEnd?: string;
}
