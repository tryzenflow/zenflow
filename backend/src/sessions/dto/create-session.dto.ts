import {
  ArrayMaxSize,
  ArrayUnique,
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
import { MAX_SCAN_DAYS, MAX_SERIES_PER_DAY } from "../../scheduler/constants";
import { IsRRule } from "../../common/validators/rrule.decorator";
import { IsFeasibleTaskWindow } from "../../common/validators/feasible-task-window.decorator";
import {
  MAX_REMINDER_MINUTES,
  MAX_REMINDERS_PER_SESSION,
  type InfeasiblePolicy,
  type SessionType,
} from "@zenflow/shared";

export const INFEASIBLE_POLICIES: InfeasiblePolicy[] = [
  "ACCEPT_CONFLICTS",
  "ACCEPT_LATE_DEADLINE",
];

export const SESSION_TYPES: SessionType[] = [
  "TASK",
  "ASSIGNMENT",
  "EXAM",
  "LECTURE",
  "DND",
];

/**
 * Ceiling on how many sittings a `TASK` series may request. The placer can
 * never place more than `MAX_SERIES_PER_DAY` sittings/day over its
 * `MAX_SCAN_DAYS`-day scheduling horizon, so a request above this product can
 * never be placed in full no matter how loose the deadline is (issue #33) —
 * `MAX_SERIES_PER_DAY × MAX_SCAN_DAYS` = 1 × 60 = 60.
 */
export const MAX_SESSION_COUNT = MAX_SERIES_PER_DAY * MAX_SCAN_DAYS;

/**
 * The 3-tab create form, flattened. `type` discriminates:
 *
 * - `TASK` — requires `deadline`; the engine places it.
 * - `ASSIGNMENT` / `EXAM` / `LECTURE` / `DND` — require `scheduledStartTime`; no
 *   deadline; may carry an `rrule` recurrence (a weekly lecture, a nightly DND).
 */
export class CreateSessionDto {
  /**
   * Answer to a prior 409 `SCHEDULE_INFEASIBLE`: `ACCEPT_CONFLICTS` places the
   * task before its deadline even overlapping other sessions;
   * `ACCEPT_LATE_DEADLINE` places it conflict-free after the deadline. Omit on
   * the first attempt.
   */
  @IsOptional()
  @IsIn(INFEASIBLE_POLICIES)
  infeasiblePolicy?: InfeasiblePolicy;

  @IsIn(SESSION_TYPES)
  type: SessionType;

  @IsString()
  @MaxLength(60, { message: "Title must be at most 60 characters." })
  title: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  note?: string | null;

  /** Free-text location (room / building) — optional for every session type. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(200, { message: "Location must be at most 200 characters." })
  location?: string | null;

  /** Session duration in minutes (always a positive multiple of 15, required). */
  @IsInt()
  @Min(TIME_GRANULARITY)
  @IsDivisibleBy(TIME_GRANULARITY)
  durationMinutes: number;

  /**
   * ISO-8601 deadline — required for a `TASK`, absent for fixed types.
   * `@IsFeasibleTaskWindow` additionally rejects a deadline that leaves no
   * time to fit `durationMinutes × sessionCount` back-to-back before it (a
   * coarse, necessary-not-sufficient check — see that decorator's doc).
   */
  @ValidateIf((o: CreateSessionDto) => o.type === "TASK")
  @IsISO8601()
  @IsFeasibleTaskWindow()
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
  @Max(MAX_SESSION_COUNT)
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

  /**
   * Minutes before start to remind the user (max 2, not for DND). Omit on
   * create for the default (60 min, non-DND); `[]` for none.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_REMINDERS_PER_SESSION)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(MAX_REMINDER_MINUTES, { each: true })
  reminders?: number[];
}
