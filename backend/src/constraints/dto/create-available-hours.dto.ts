import { IsInt, Min, Max, ValidateIf } from "class-validator";
import { DAILY_HORIZON } from "../../common/constants";

export class CreateAvailableHoursDto {
  @IsInt()
  @Min(0)
  @Max(DAILY_HORIZON)
  @ValidateIf((o: CreateAvailableHoursDto) => o.end > o.start, {
    message: "Start time must be less than end time",
  })
  start: number;

  @IsInt()
  @Min(0)
  @Max(DAILY_HORIZON)
  end: number;
}
