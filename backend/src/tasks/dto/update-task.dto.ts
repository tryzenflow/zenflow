import {
  IsArray,
  IsDivisibleBy,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateIf,
} from "class-validator";
import { DAILY_HORIZON, TIME_GRANULARITY } from "src/common/constants";
import type { UpdateTaskInput } from "@zenflow/shared";

/**
 * Form-based task update. Metadata fields do NOT trigger rescheduling;
 * changing `deadline` (flexible tasks) or `durationMinutes` (any task)
 * triggers an EDF cascade reschedule (see docs ADR/api-contracts).
 */
export class UpdateTaskDto implements UpdateTaskInput {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  note?: string | null;

  /** New duration in minutes (positive multiple of 15, max one day). */
  @IsOptional()
  @IsInt()
  @Min(TIME_GRANULARITY)
  @Max(DAILY_HORIZON)
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
}
