import {
  IsArray,
  IsBoolean,
  IsDivisibleBy,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
} from "class-validator";
import type { UpdateScope, UpdateSessionInput } from "@zenflow/shared";
import { TIME_GRANULARITY } from "../../common/constants";
import { IsRRule } from "../../common/validators/rrule.decorator";

/**
 * Generic metadata / reschedule / resize update — one `PATCH /sessions/:id`
 * covers all of it. Every field is a plain diff applied directly. A change to a
 * scheduled TASK's `scheduledStartTime` / `durationMinutes` also emits a `MOVE`
 * SessionEvent (see `SessionsService.update`).
 */
export class UpdateSessionDto implements UpdateSessionInput {
  @IsOptional()
  @IsString()
  @MaxLength(60, { message: "Title must be at most 60 characters." })
  title?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  note?: string | null;

  @IsOptional()
  @IsInt()
  @Min(TIME_GRANULARITY)
  @IsDivisibleBy(TIME_GRANULARITY)
  durationMinutes?: number;

  /** ISO-8601 deadline (TASK only). Omit to leave unchanged. */
  @IsOptional()
  @IsISO8601()
  deadline?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  /** ISO-8601 instant — drag reschedule / resize both just move this. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsISO8601()
  scheduledStartTime?: string | null;

  /** RFC 5545 RRULE — for a recurring fixed session's series. `null` drops it. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsRRule()
  rrule?: string | null;

  /** Which series members a `scheduledStartTime`/`durationMinutes` change applies to. */
  @IsOptional()
  @IsIn(["occurrence", "following", "series"])
  scope?: UpdateScope;

  /**
   * With `scope: "following" | "series"`, leave any instance whose new landing
   * slot would overlap another session untouched instead of moving it there.
   * Ignored otherwise.
   */
  @IsOptional()
  @IsBoolean()
  skipConflicting?: boolean;
}
