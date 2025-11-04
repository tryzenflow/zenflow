import { IsDivisibleBy, IsISO8601, Max, Min } from "class-validator";
import { DAILY_HORIZON } from "../../common/constants";

export class UpdateScheduleDto {
  @Min(0)
  @Max(DAILY_HORIZON)
  @IsDivisibleBy(5)
  start: number;

  @Min(0)
  @Max(DAILY_HORIZON)
  @IsDivisibleBy(5)
  end: number;
}
