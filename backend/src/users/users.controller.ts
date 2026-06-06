import { Body, Controller, Get, Patch, Post, Put, UseGuards } from "@nestjs/common";
import { UpdateUserDto } from "./dto/update-user.dto";
import { UpdatePreferencesDto } from "./dto/update-preferences.dto";
import { OnboardingDto } from "./dto/onboarding.dto";
import { UsersService } from "./users.service";
import { CurrentUser } from "./decorators/current-user.decorator";
import type { User } from "../../generated/prisma";
import { CookieAuthGuard } from "../auth/guards";

@Controller("users")
@UseGuards(CookieAuthGuard)
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get("me")
  me(@CurrentUser() user: User) {
    return { success: true, data: user };
  }

  @Patch("update/basic-info")
  async updateBasicInfo(@Body() dto: UpdateUserDto, @CurrentUser() user: User) {
    const updated = await this.usersService.update(user.id, dto);
    return { success: true, data: updated };
  }

  @Put("me/preferences")
  async updatePreferences(
    @Body() dto: UpdatePreferencesDto,
    @CurrentUser() user: User,
  ) {
    const updated = await this.usersService.updatePreferences(user, dto);
    return { success: true, message: "Preferences updated", data: updated };
  }

  @Post("me/onboarding")
  async onboarding(@Body() dto: OnboardingDto, @CurrentUser() user: User) {
    const updated = await this.usersService.completeOnboarding(user, dto);
    return { success: true, message: "Onboarding complete", data: updated };
  }
}
