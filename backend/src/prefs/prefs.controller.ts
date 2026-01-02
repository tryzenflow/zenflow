import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  UseGuards,
  ParseIntPipe,
} from "@nestjs/common";
import { UserPreferencesService } from "./prefs.service";
import { UpdateUserPreferenceDto } from "./dto/update-pref.dto";
import { CookieAuthGuard } from "../auth/guards";
import { CurrentUser } from "../users/decorators/current-user.decorator";
import { type User } from "../../generated/prisma";

@Controller("prefs")
@UseGuards(CookieAuthGuard)
export class UserPreferencesController {
  constructor(
    private readonly userPreferencesService: UserPreferencesService,
  ) {}

  @Get()
  async get(@CurrentUser() user: User) {
    const userPreferences = await this.userPreferencesService.getAll(user.id);
    return {
      success: true,
      message: `Found ${userPreferences.length} preferences for user`,
      data: userPreferences,
    };
  }

  @Patch(":day")
  async update(
    @Param("day", ParseIntPipe) day: number,
    @Body() updateUserPreferencesDto: UpdateUserPreferenceDto,
    @CurrentUser() user: User,
  ) {
    const updated = await this.userPreferencesService.update(
      day,
      user.id,
      updateUserPreferencesDto,
    );
    return {
      success: true,
      message: `Update successfully userPreference on ${day}`,
      data: updated,
    };
  }
}
