import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsDivisibleBy,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import { DAILY_HORIZON } from "../../common/constants";
import { IsRRule } from "../validators/is-rrule.validator";

export class CreateTaskDto {
  @IsString() title: string;

  @IsDateString()
  @MaxLength(10)
  @IsOptional()
  scheduleDate?: string;

  @IsOptional()
  @IsRRule({ message: "Invalid RRULE: must follow RFC 5545 format" })
  rrule?: string;

  @IsString() @IsOptional() note?: string;

  @IsInt()
  @Min(5)
  @IsDivisibleBy(5)
  duration: number;

  @IsInt()
  @Min(1)
  @Max(3)
  priority: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(DAILY_HORIZON)
  earliestStart?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(DAILY_HORIZON)
  latestEnd?: number;

  @IsOptional()
  @IsISO8601()
  deadline?: string;

  @IsBoolean()
  @IsOptional()
  mandatory?: boolean;

  @IsInt()
  @Min(1)
  @IsOptional()
  maxSplits?: number;

  @IsInt()
  @Min(1)
  @Max(3)
  focus: number;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsArray()
  prerequisites?: string[];
}
