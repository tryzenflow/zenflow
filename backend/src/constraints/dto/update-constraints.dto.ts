import { PartialType } from "@nestjs/mapped-types";
import { CreateConstraintsDto } from "./create-constraints.dto";
import { IsArray, IsOptional, IsString } from "class-validator";
import { UpdateEnergyBlockDto } from "./update-energy-block.dto";
import { UpdateAvailableHoursDto } from "./update-available-hours.dto";

export class UpdateConstraintsDto extends PartialType(CreateConstraintsDto) {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  deleteAvailableHoursIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  deleteEnergyBlocksIds?: string[];

  @IsOptional()
  @IsArray()
  updateEnergyBlocksDto?: UpdateEnergyBlockDto[];

  @IsOptional()
  @IsArray()
  updateAvailableHoursDto?: UpdateAvailableHoursDto[];
}
