import { IsNotEmpty } from "class-validator";
import { CreateEnergyBlockDto } from "./create-energy-block.dto";
import { PartialType } from "@nestjs/mapped-types";

export class UpdateEnergyBlockDto extends CreateEnergyBlockDto {
  @IsNotEmpty()
  id: string;
}
