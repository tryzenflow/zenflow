import { IsNotEmpty, IsString } from "class-validator";
import type { DeviceStatusInput } from "@zenflow/shared";

/** Body for `POST /devices/status`. */
export class DeviceStatusDto implements DeviceStatusInput {
  @IsString()
  @IsNotEmpty()
  pushToken!: string;
}
