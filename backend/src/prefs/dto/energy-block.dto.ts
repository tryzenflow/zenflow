import { IsInt, Min, Max, IsPositive, IsNumber } from "class-validator";
import { DAILY_HORIZON } from "../../common/constants";

export class EnergyBlockDto {
  @IsPositive()
  @Min(1)
  @Max(3)
  energy: number;

  @IsInt()
  @Min(0)
  @Max(DAILY_HORIZON)
  start: number;

  @IsInt()
  @Min(0)
  @Max(DAILY_HORIZON)
  end: number;

  @IsNumber()
  @Min(0)
  @Max(1)
  confidence?: number;
}
