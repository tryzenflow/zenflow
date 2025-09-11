import {
  IsArray,
  IsBoolean,
  IsDivisibleBy,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  Min,
} from "class-validator";
import { DAILY_HORIZON } from "../../common/constants";

export class CreateTaskDto {
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
