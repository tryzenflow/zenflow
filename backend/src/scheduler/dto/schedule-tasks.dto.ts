import {
  IsBoolean,
  IsDateString,
  IsOptional,
  MaxLength,
} from "class-validator";

export class ScheduleTasksDto {
  @IsDateString()
  @MaxLength(10)
  scheduleDate: string;

  @IsBoolean()
  @IsOptional()
  scheduleBased: boolean = true;
}
