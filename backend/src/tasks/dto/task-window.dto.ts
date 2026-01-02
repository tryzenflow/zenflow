import { Min, Max, IsInt } from "class-validator";
import { DAILY_HORIZON, TIME_GRANULARITY } from "src/common/constants";
import { IsEndTimeAfterStartTime } from "../validators/start-end.decorator";

export class TaskWindowDto {
  @IsInt()
  @Min(0)
  @Max(DAILY_HORIZON - TIME_GRANULARITY)
  start: number;

  @IsInt()
  @Min(0)
  @Max(DAILY_HORIZON)
  @IsEndTimeAfterStartTime()
  end: number;
}
