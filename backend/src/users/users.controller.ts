import { Body, Controller, Get, Patch, UseGuards } from "@nestjs/common";
import { UpdateUserDto } from "./dto/update-user.dto";
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

  @Get("me/preference-matrix")
  async preferenceMatrix(@CurrentUser() user: User) {
    const data = await this.usersService.getPreferenceMatrix(user);
    return { success: true, data };
  }
}
