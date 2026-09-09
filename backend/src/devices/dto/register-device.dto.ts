import { IsEnum, IsNotEmpty, IsString } from "class-validator";
import type { RegisterDeviceInput } from "@zenflow/shared";
import { DevicePlatform } from "../../../generated/prisma";

/** Body for `POST /devices`. */
export class RegisterDeviceDto implements RegisterDeviceInput {
  @IsEnum(DevicePlatform)
  platform!: DevicePlatform;

  @IsString()
  @IsNotEmpty()
  pushToken!: string;
}
