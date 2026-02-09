import { Min, Max, IsDivisibleBy } from "class-validator";
import { DAILY_HORIZON, TIME_GRANULARITY } from "src/common/constants";
import { IsEndTimeAfterStartTime } from "src/tasks/validators/start-end.decorator";

export class IntervalDto {
  @Min(0)
  @Max(DAILY_HORIZON)
  @IsDivisibleBy(TIME_GRANULARITY)
  start: number;

  @Min(0)
  @Max(DAILY_HORIZON)
  @IsDivisibleBy(TIME_GRANULARITY)
  @IsEndTimeAfterStartTime()
  end: number;
}
