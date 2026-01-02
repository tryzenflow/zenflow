import { IsInt, Min, IsArray, Max, IsDivisibleBy } from "class-validator";
import { EnergyBlockDto } from "./energy-block.dto";
import { DAILY_HORIZON, TIME_GRANULARITY } from "../../common/constants";
import { NoOverlap } from "../validators/no-overlap.decorator";

export class CreateUserPreferenceDto {
  @IsInt()
  @Min(0)
  @Max(DAILY_HORIZON)
  @IsDivisibleBy(TIME_GRANULARITY)
  minGapBetweenTasks: number;

  @IsInt()
  @Min(0)
  @Max(6)
  day: number;

  @IsArray()
  @NoOverlap()
  energyBlocks: EnergyBlockDto[];
}
