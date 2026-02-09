import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import { DAILY_HORIZON } from "src/common/constants";

export class ScheduleTasksDto {
  @IsOptional()
  @IsDateString()
  @MaxLength(10)
  scheduleDate: string;

  @IsOptional()
  @IsBoolean()
  keepManual: boolean = true;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(DAILY_HORIZON)
  minTime: number = 0;
}
