import {
  IsDateString,
  IsDivisibleBy,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from "class-validator";
import type { SeedTaskInput } from "@zenflow/shared";
import { SessionType } from "../../../generated/prisma";

/** Body for `POST /test/seed-task` (test builds only). */
export class SeedTaskDto implements SeedTaskInput {
  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsEnum(SessionType)
  type!: SessionType;

  @IsDateString()
  deadline!: string;

  /** Slot-grid rule: positive multiples of 15 only. */
  @IsInt()
  @Min(15)
  @IsDivisibleBy(15)
  durationMinutes!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  sessionCount?: number;

  /** Required: a live session row never has a null `scheduledStartTime`. */
  @IsDateString()
  scheduledStartTime!: string;
}
