import { IsDivisibleBy, IsInt, IsISO8601, Min } from "class-validator";
import { TIME_GRANULARITY } from "../../common/constants";
import type { ResizeInput } from "@zenflow/shared";

/** Manual edge-resize from the calendar; pins the task and recomputes conflicts. */
export class ResizeTaskDto implements ResizeInput {
  @IsISO8601()
  requestedStartTime: string;

  @IsInt()
  @Min(TIME_GRANULARITY)
  @IsDivisibleBy(TIME_GRANULARITY)
  durationMinutes: number;
}
