import { Body, Controller, Get, Put, UseGuards } from "@nestjs/common";
import type { DailyPushSettings } from "@zenflow/shared";
import type { User } from "../../generated/prisma";
import { CookieAuthGuard } from "../auth/guards";
import { CurrentUser } from "../users/decorators/current-user.decorator";
import { DailyPushService } from "./daily-push.service";
import { UpdateDailyPushDto } from "./dto/update-daily-push.dto";

@Controller("users/me/daily-push")
@UseGuards(CookieAuthGuard)
export class DailyPushController {
  constructor(private readonly dailyPush: DailyPushService) {}

  @Get()
  async get(@CurrentUser() user: User) {
    const data: DailyPushSettings = await this.dailyPush.getSettings(user.id);
    return { success: true, message: "Daily push settings", data };
  }

  @Put()
  async update(@Body() dto: UpdateDailyPushDto, @CurrentUser() user: User) {
    const data = await this.dailyPush.updateSettings(user, dto);
    return { success: true, message: "Daily push settings saved", data };
  }
}
