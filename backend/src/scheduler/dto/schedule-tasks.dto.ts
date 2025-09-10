import { IsDateString, IsNotEmpty } from "class-validator";

export class ScheduleTasksDto {
  @IsDateString()
  scheduleDate: string;

  @IsNotEmpty({ each: true })
  taskIds: string[];
}
