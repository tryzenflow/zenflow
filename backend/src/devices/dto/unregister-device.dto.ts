import { IsNotEmpty, IsString } from "class-validator";
import type { UnregisterDeviceInput } from "@zenflow/shared";

/** Body for `DELETE /devices`. */
export class UnregisterDeviceDto implements UnregisterDeviceInput {
  @IsString()
  @IsNotEmpty()
  pushToken!: string;
}
