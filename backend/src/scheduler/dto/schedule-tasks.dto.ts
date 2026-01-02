import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsOptional,
  IsUUID,
  MaxLength,
} from "class-validator";

export class ScheduleTasksDto {
  @IsDateString()
  @MaxLength(10)
  scheduleDate: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsUUID("4", { each: true })
  taskIds: string[];

  @IsOptional()
  @IsBoolean()
  keepManual: boolean = true;
}
