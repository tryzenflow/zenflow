import {
  IsArray,
  IsDateString,
  IsDivisibleBy,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
} from "class-validator";
import { TIME_GRANULARITY } from "src/common/constants";
import {
  VIEW_MODES,
  type CreateTaskInput,
  type ViewMode,
} from "@zenflow/shared";

export class CreateTaskDto implements CreateTaskInput {
  @IsString() title: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  note?: string | null;

  /** Task duration in minutes (always a positive multiple of 15, required). */
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

  /**
   * 'YYYY-MM-DD' day the task was created from, in the user's tz. Informational
   * only — every task is flexible now, so the engine no longer anchors
   * placement to it. Defaults to today.
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
