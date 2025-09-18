import { IsDateString, IsNotEmpty, MaxLength } from "class-validator";

export class ScheduleTasksDto {
  @IsDateString()
  @MaxLength(10)
  scheduleDate: string;

  @IsNotEmpty({ each: true })
  taskIds: string[];
}
