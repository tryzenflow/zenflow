import { IsInt, Min, Max, ValidateIf } from "class-validator";
import { DAILY_HORIZON } from "../../common/constants";

export class CreateEnergyBlockDto {
  @IsInt()
  @Min(1)
  @Max(3)
  energyLevel: number;

  @IsInt()
  @Min(0)
  @Max(DAILY_HORIZON)
  @ValidateIf((o: CreateEnergyBlockDto) => o.end > o.start)
  start: number;

  @IsInt()
  @Min(0)
  @Max(DAILY_HORIZON)
  end: number;
}
