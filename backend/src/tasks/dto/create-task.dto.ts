import {
  IsArray,
  IsDivisibleBy,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
} from "class-validator";
import { TIME_GRANULARITY } from "../../common/constants";
import { MaxWords } from "../../common/validators/max-words.decorator";
import type { CreateTaskInput } from "@zenflow/shared";

export class CreateTaskDto implements CreateTaskInput {
  @IsString()
  @MaxWords(60, { message: "Title must be at most 60 words." })
  title: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  note?: string | null;

  /** Task duration in minutes (always a positive multiple of 15, required). */
  @IsInt()
  @Min(TIME_GRANULARITY)
  @IsDivisibleBy(TIME_GRANULARITY)
  durationMinutes: number;

  /** Required — the view-scoped scheduling model is gone. */
  @IsISO8601()
  deadline: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}
