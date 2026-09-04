import {
  IsArray,
  IsDivisibleBy,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from "class-validator";
import { TIME_GRANULARITY } from "../../common/constants";
import { IsRRule } from "../../common/validators/rrule.decorator";
import type { SessionType } from "@zenflow/shared";

export const SESSION_TYPES: SessionType[] = [
  "TASK",
  "ASSIGNMENT",
  "EXAM",
  "LECTURE",
  "DND",
];

/**
 * The 3-tab create form, flattened. `type` discriminates:
 *
 * - `TASK` — requires `deadline`; the engine places it.
 * - `ASSIGNMENT` / `EXAM` / `LECTURE` / `DND` — require `scheduledStartTime`; no
 *   deadline; may carry an `rrule` recurrence (a weekly lecture, a nightly DND).
 */
export class CreateSessionDto {
  @IsIn(SESSION_TYPES)
  type: SessionType;

  @IsString()
  @MaxLength(60, { message: "Title must be at most 60 characters." })
  title: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  note?: string | null;

  /** Session duration in minutes (always a positive multiple of 15, required). */
  @IsInt()
  @Min(TIME_GRANULARITY)
  @IsDivisibleBy(TIME_GRANULARITY)
  durationMinutes: number;

  /** ISO-8601 deadline — required for a `TASK`, absent for fixed types. */
  @ValidateIf((o: CreateSessionDto) => o.type === "TASK")
  @IsISO8601()
  deadline?: string;

  /**
   * Number of study sessions (`TASK` only). Omitted or `1` → one ordinary
   * task; `> 1` → a `TASK` series of N linked sessions spread across
   * `now … deadline` (see `docs/scheduler/heuristic.md`).
   */
  @IsOptional()
  @ValidateIf((o: CreateSessionDto) => o.type === "TASK")
  @IsInt()
  @Min(1)
  @Max(30)
  sessionCount?: number;

  /** ISO-8601 start — required for the fixed types (`ASSIGNMENT`/`EXAM`/`LECTURE`/`DND`). */
  @ValidateIf((o: CreateSessionDto) => o.type !== "TASK")
  @IsISO8601()
  scheduledStartTime?: string;

  /** RFC 5545 RRULE — any fixed type, optional (one-off when omitted). */
  @ValidateIf((o: CreateSessionDto) => o.type !== "TASK" && o.rrule != null)
  @IsRRule()
  rrule?: string | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}
