import { IsNotEmpty } from "class-validator";
import { EnergyZoneDto } from "./energy-block.dto";

export class UpdateEnergyZoneDto extends EnergyZoneDto {
  @IsNotEmpty()
  id: string;
}
