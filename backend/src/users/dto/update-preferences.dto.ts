import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateIf,
} from "class-validator";
import { IsValidTimezone } from "src/common/validators/valid-timezone.decorator";
import { DAILY_HORIZON } from "src/common/constants";
import type {
  DurationAdjustmentMode,
  UpdatePreferencesInput,
} from "@zenflow/shared";

export class UpdatePreferencesDto implements UpdatePreferencesInput {
  @IsInt() @Min(0) @Max(DAILY_HORIZON) workStart: number;

  @IsInt() @Min(0) @Max(DAILY_HORIZON) workEnd: number;

  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(7, { each: true })
  workDays: number[];

  @IsString()
  @IsValidTimezone()
  timezone: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  roleArchetypeId?: string | null;

  /** Duration-corrector UX mode; optional (partial update). */
  @IsOptional()
  @IsIn(["auto", "ask", "never"])
  durationAdjustmentMode?: DurationAdjustmentMode;
}
