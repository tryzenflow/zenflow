import { IsInt, Min, IsArray, Max, IsDivisibleBy } from "class-validator";
import { EnergyZoneDto } from "./energy-block.dto";
import { DAILY_HORIZON, TIME_GRANULARITY } from "../../common/constants";
import { NoOverlap } from "../validators/no-overlap.decorator";

export class CreateUserPreferenceDto {
  @IsInt()
  @Min(0)
  @Max(DAILY_HORIZON)
  @IsDivisibleBy(TIME_GRANULARITY)
  breakMinutes: number;

  @IsInt()
  @Min(0)
  @Max(6)
  day: number;

  @IsArray()
  @NoOverlap()
  energyZones: EnergyZoneDto[];
}
