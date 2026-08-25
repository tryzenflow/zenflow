import {
  IsArray,
  IsDivisibleBy,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
} from "class-validator";
import { TIME_GRANULARITY } from "../../common/constants";
import type { CreateSessionInput } from "@zenflow/shared";

export class CreateSessionDto implements CreateSessionInput {
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

  /** ISO-8601 deadline — required (the DB column is NOT NULL). */
  @IsISO8601()
  deadline: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}
