import { OmitType, PartialType } from "@nestjs/mapped-types";
import { CreateConstraintsDto as CreateConstraintDto } from "./create-constraint.dto";
import { IsArray, IsOptional, IsString } from "class-validator";
import { UpdateFocusBlockDto } from "./update-focus-block.dto";
import { UpdateAvailableHoursDto } from "./update-available-hours.dto";

export class UpdateConstraintDto extends PartialType(
  OmitType(CreateConstraintDto, ["weekday"])
) {
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
