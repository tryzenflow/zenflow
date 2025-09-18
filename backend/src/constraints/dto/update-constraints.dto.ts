import { PartialType } from "@nestjs/mapped-types";
import { CreateConstraintsDto } from "./create-constraints.dto";
import { IsArray, IsOptional, IsString } from "class-validator";
import { UpdateFocusBlockDto } from "./update-energy-block.dto";
import { UpdateAvailableHoursDto } from "./update-available-hours.dto";

export class UpdateConstraintsDto extends PartialType(CreateConstraintsDto) {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  deleteAvailableHoursIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  deleteFocusBlocksIds?: string[];

  @IsOptional()
  @IsArray()
  updateFocusBlocksDto?: UpdateFocusBlockDto[];

  @IsOptional()
  @IsArray()
  updateAvailableHoursDto?: UpdateAvailableHoursDto[];
}
