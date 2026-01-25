import { IsBoolean, IsDivisibleBy, IsISO8601, Max, MaxLength, Min } from "class-validator";
import { DAILY_HORIZON, TIME_GRANULARITY } from "../../common/constants";
import { IsEndTimeAfterStartTime } from "src/tasks/validators/start-end.decorator";

export class UpdateScheduledBlockDto {
  @IsISO8601()
  @MaxLength(10)
  date: string;

  @Min(0)
  @Max(DAILY_HORIZON)
  @IsDivisibleBy(TIME_GRANULARITY)
  start: number;

  @Min(0)
  @Max(DAILY_HORIZON)
  @IsDivisibleBy(TIME_GRANULARITY)
  @IsEndTimeAfterStartTime()
  end: number;

  @IsBoolean()
  completed: boolean;
}
