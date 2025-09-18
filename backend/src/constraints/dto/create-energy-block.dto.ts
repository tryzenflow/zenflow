import { IsInt, Min, Max, ValidateIf } from "class-validator";
import { DAILY_HORIZON } from "../../common/constants";

export class CreateFocusBlockDto {
  @IsInt()
  @Min(1)
  @Max(3)
  level: number;

  @IsInt()
  @Min(0)
  @Max(DAILY_HORIZON)
  @ValidateIf((o: CreateFocusBlockDto) => o.end > o.start)
  start: number;

  @IsInt()
  @Min(0)
  @Max(DAILY_HORIZON)
  end: number;
}
