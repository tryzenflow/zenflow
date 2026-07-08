import {
  IsDivisibleBy,
  IsInt,
  IsISO8601,
  IsOptional,
  Min,
} from "class-validator";
import { TIME_GRANULARITY } from "src/common/constants";
import type { RescheduleCascadeInput } from "@zenflow/shared";

/**
 * Body for `POST /tasks/:id/reschedule-cascade`: explicitly triggers the
 * view-scoped `cascadeReschedule` for this task. Used after the user confirms
 * a deadline-change reschedule prompt (`durationMinutes` omitted), or accepts
 * a tag-driven duration-adjustment suggestion that needs a new slot
 * (`durationMinutes` supplied — applied before the cascade runs).
 */
export class RescheduleCascadeDto implements RescheduleCascadeInput {
  @IsOptional()
  @IsISO8601()
  viewStart?: string;

  @IsOptional()
  @IsISO8601()
  viewEnd?: string;

  @IsOptional()
  @IsInt()
  @Min(TIME_GRANULARITY)
  @IsDivisibleBy(TIME_GRANULARITY)
  durationMinutes?: number;
}
