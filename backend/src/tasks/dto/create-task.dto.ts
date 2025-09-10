import {
  IsOptional,
  IsString,
  IsInt,
  Min,
  Max,
  IsBoolean,
  IsArray,
  IsISO8601,
  IsDivisibleBy,
  IsDateString,
  IsNumber,
} from "class-validator";
import { DAILY_HORIZON } from "../../common/constants";

export class CreateTaskDto {
  @IsOptional() @IsString() id?: string;

  @IsString() title: string;

  @IsInt()
  @Min(5)
  @IsDivisibleBy(5)
  duration: number;

  @IsInt()
  @Min(1)
  @Max(3)
  @IsOptional()
  priority?: number = 3;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(DAILY_HORIZON)
  fixedStart?: number;

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

  @IsBoolean()
  @IsOptional()
  splittable?: boolean;

  @IsInt()
  @Min(1)
  @IsOptional()
  maxSplits?: number;

  @IsInt()
  @Min(1)
  @Max(3)
  @IsOptional()
  energyLevel?: number = 1;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsArray()
  prerequisites?: string[];
}
