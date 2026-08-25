import {
  IsArray,
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
import type { TaskStatus, UpdateTaskInput } from "@zenflow/shared";
import { TIME_GRANULARITY } from "../../common/constants";

/**
 * Generic metadata/reschedule/resize/complete update — one `PATCH /tasks/:id`
 * covers all of it. Every field is a plain diff applied directly; there is no
 * cascade, conflict recompute, or displaced-tasks side effect.
 */
export class UpdateTaskDto implements UpdateTaskInput {
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

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsISO8601()
  deadline?: string | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  /** ISO-8601 instant — drag reschedule / resize both just move this. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsISO8601()
  scheduledStartTime?: string | null;

  @IsOptional()
  @IsIn(["PENDING", "DONE", "ABANDONED"])
  status?: TaskStatus;
}
