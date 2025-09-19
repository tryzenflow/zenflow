import { IsInt, Min, IsBoolean, IsArray, Max } from "class-validator";
import { CreateFocusBlockDto } from "./create-focus-block.dto";
import { CreateAvailableHoursDto } from "./create-available-hours.dto";
import { DAILY_HORIZON } from "../../common/constants";

export class CreateConstraintsDto {
  @IsArray()
  availableHours: CreateAvailableHoursDto[];

  @IsInt()
  @Min(0)
  @Max(DAILY_HORIZON)
  minGapBetweenTasks: number;

  @IsInt()
  @Min(0)
  @Max(DAILY_HORIZON)
  maxDailyLoad: number;

  @IsInt()
  @Min(0)
  @Max(6)
  weekday: number;

  @IsBoolean()
  batchSimilarTasks: boolean;

  @IsArray()
  focusBlocks: CreateFocusBlockDto[];
}
