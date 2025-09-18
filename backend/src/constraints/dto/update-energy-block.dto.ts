import { IsNotEmpty } from "class-validator";
import { CreateFocusBlockDto } from "./create-energy-block.dto";
import { PartialType } from "@nestjs/mapped-types";

export class UpdateFocusBlockDto extends CreateFocusBlockDto {
  @IsNotEmpty()
  id: string;
}
