import { IsNotEmpty } from "class-validator";
import { EnergyBlockDto } from "./energy-block.dto";

export class UpdateEnergyBlockDto extends EnergyBlockDto {
  @IsNotEmpty()
  id: string;
}
