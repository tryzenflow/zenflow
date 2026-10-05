import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Post,
  UseGuards,
} from "@nestjs/common";
import { CookieAuthGuard } from "../auth/guards";
import { CurrentUser } from "../users/decorators/current-user.decorator";
import { type User } from "../../generated/prisma";
import { DevicesService } from "./devices.service";
import { RegisterDeviceDto } from "./dto/register-device.dto";
import { UnregisterDeviceDto } from "./dto/unregister-device.dto";

/**
 * Device registry for native push (FCM on Android, APNs on iOS).
 *
 * Register on login and on every token refresh; unregister on logout. There is
 * deliberately no list route — a user's device tokens are not something the
 * client reads back.
 */
@Controller("devices")
@UseGuards(CookieAuthGuard)
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  /** Register this device, or refresh its row. Idempotent (upsert on token). */
  @Post()
  @HttpCode(200)
  async register(@CurrentUser() user: User, @Body() dto: RegisterDeviceDto) {
    const data = await this.devices.registerDevice(user, dto);
    return { success: true, message: "Device registered", data };
  }

  /** Unregister this device by its token. Idempotent; scoped to the caller. */
  @Delete()
  async unregister(
    @CurrentUser() user: User,
    @Body() dto: UnregisterDeviceDto,
  ) {
    const data = await this.devices.unregisterDevice(user, dto.pushToken);
    return { success: true, message: "Device unregistered", data };
  }
}
