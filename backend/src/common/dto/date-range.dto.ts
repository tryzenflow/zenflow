import { IsDateString, MaxLength } from "class-validator";
import { IsEndDateAfterStartDate } from "../validators/start-end-date.decorator";

export class DateRangeDto {
  @MaxLength(10)
  @IsDateString()
  start: string;

  @MaxLength(10)
  @IsDateString()
  @IsEndDateAfterStartDate()
  end: string;
}
