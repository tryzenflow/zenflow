import { IsArray } from "class-validator";
import { CreateCategoryDto } from "./create-category.dto";

export class PopulateCategoriesDto {
  @IsArray()
  categories: CreateCategoryDto[];
}
