import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsDivisibleBy,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateIf,
} from "class-validator";
import { IsRRule } from "../validators/is-rrule.decorator";
import { DAILY_HORIZON, TIME_GRANULARITY } from "src/common/constants";
import type { CreateTaskInput } from "@zenflow/shared";

export class CreateTaskDto implements CreateTaskInput {
  @IsString() title: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  note?: string | null;

  @IsInt()
  @Min(TIME_GRANULARITY)
  @IsDivisibleBy(TIME_GRANULARITY)
  durationMinutes: number;

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

  /** Minutes from midnight; only used when {@link fixed} is true. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(DAILY_HORIZON)
  startTime?: number;

  /**
   * 'YYYY-MM-DD' day the task was created from, in the user's tz. For a fixed
   * task it's the exact anchor day; for a flexible task it's the earliest day
   * the engine may place it on. Defaults to today.
   */
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsRRule({ message: "Invalid RRULE: must follow RFC 5545 format" })
  rrule?: string;
}
