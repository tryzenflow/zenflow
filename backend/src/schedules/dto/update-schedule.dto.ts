import { IsBoolean, IsISO8601, IsOptional, MaxLength } from "class-validator";
import { IntervalDto } from "./interval.dto";

export class UpdateEventDto {
  @IsISO8601()
  @MaxLength(10)
  date: string;

  @IsOptional()
  interval?: IntervalDto;

  @IsBoolean()
  completed?: boolean;
}
