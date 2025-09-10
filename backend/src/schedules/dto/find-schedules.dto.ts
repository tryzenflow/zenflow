import { IsDateString } from "class-validator";

export class FindSchedulesDto {
  @IsDateString()
  start?: string;

  @IsDateString()
  end?: string;
}
