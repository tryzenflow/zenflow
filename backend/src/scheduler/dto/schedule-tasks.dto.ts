import { IsDateString, MaxLength } from "class-validator";

export class ScheduleTasksDto {
  @IsDateString()
  @MaxLength(10)
  scheduleDate: string;
}
