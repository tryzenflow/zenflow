import { IsDateString, MaxLength } from "class-validator";

export class FindSchedulesDto {
  @MaxLength(10)
  @IsDateString()
  start: string;

  @MaxLength(10)
  @IsDateString()
  end: string;
}
