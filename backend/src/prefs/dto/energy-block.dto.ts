import { IsInt, Min, Max, IsPositive } from "class-validator";
import { DAILY_HORIZON } from "../../common/constants";

export class EnergyZoneDto {
  @IsPositive()
  @Min(1)
  @Max(3)
  level: number;

  @IsInt()
  @Min(0)
  @Max(DAILY_HORIZON)
  start: number;

  @IsInt()
  @Min(0)
  @Max(DAILY_HORIZON)
  end: number;
}
