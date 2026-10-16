import { Controller, Get, UseGuards } from "@nestjs/common";
import type { StreakResponse } from "@zenflow/shared";
import { CookieAuthGuard } from "../auth/guards";
import { CurrentUser } from "../users/decorators/current-user.decorator";
import type { User } from "../../generated/prisma";
import { StreaksService } from "./streaks.service";

@Controller("users/me/streak")
@UseGuards(CookieAuthGuard)
export class StreaksController {
  constructor(private readonly streaks: StreaksService) {}

  @Get()
  async get(@CurrentUser() user: User) {
    const data: StreakResponse = await this.streaks.refresh(user);
    return { success: true, message: "Streak", data };
  }
}
