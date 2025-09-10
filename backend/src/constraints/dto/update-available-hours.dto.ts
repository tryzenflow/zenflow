import { IsNotEmpty } from "class-validator";
import { CreateAvailableHoursDto } from "./create-available-hours.dto";

export class UpdateAvailableHoursDto extends CreateAvailableHoursDto {
  @IsNotEmpty()
  id: string;
}
