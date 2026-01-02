import {
  ArrayMinSize,
  IsArray,
  IsDivisibleBy,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateIf,
} from "class-validator";
import { IsRRule } from "../validators/is-rrule.decorator";
import { TIME_GRANULARITY } from "src/common/constants";
import { TaskWindowDto } from "./task-window.dto";

export class CreateTaskDto {
  @IsString() title: string;

  @IsOptional()
  @IsRRule({ message: "Invalid RRULE: must follow RFC 5545 format" })
  rrule?: string;

  @IsString() @IsOptional() note?: string;

  @IsInt()
  @Min(TIME_GRANULARITY)
  @IsDivisibleBy(TIME_GRANULARITY)
  duration: number;

  @IsInt()
  @Min(1)
  @Max(3)
  priority: number;

  @IsOptional()
  @ValidateIf((object, value) => value !== null)
  @IsISO8601()
  deadline?: string | null;

  @IsInt()
  @Min(1)
  @Max(3)
  energy: number;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @ValidateIf((object, value) => value !== null)
  fixedWindow?: TaskWindowDto | null;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  preferredWindows?: TaskWindowDto[];
}
