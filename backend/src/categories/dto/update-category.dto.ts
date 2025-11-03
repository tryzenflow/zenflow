import { PartialType } from "@nestjs/mapped-types";
import { CreateCategoryDto } from "./create-category.dto";
import { IsOptional, IsUUID } from "class-validator";

export class UpdateCategoryDto extends PartialType(CreateCategoryDto) {
  @IsUUID(4)
  @IsOptional()
  beforeId?: string;

  @IsUUID(4)
  @IsOptional()
  afterId?: string;
}
