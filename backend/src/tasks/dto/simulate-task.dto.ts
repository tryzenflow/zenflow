import {
  IsArray,
  IsDivisibleBy,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Min,
} from "class-validator";
import { TIME_GRANULARITY } from "../../common/constants";
import type { SimulateTaskInput } from "@zenflow/shared";

/**
 * Body for `POST /tasks/simulate`: a read-only dry-run of the scheduler for a
 * not-yet-created task. No DB write.
 */
export class SimulateTaskDto implements SimulateTaskInput {
  @IsInt()
  @Min(TIME_GRANULARITY)
  @IsDivisibleBy(TIME_GRANULARITY)
  durationMinutes: number;

  @IsISO8601()
  deadline: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}
