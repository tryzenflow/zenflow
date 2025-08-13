import { Body, Controller, Put, UseGuards } from "@nestjs/common";
import { UpdateUserDto } from "./dto";
import { UsersService } from "./users.service";
import { CurrentUser } from "./decorators";
import type { User } from "../../generated/prisma";
import { CookieAuthGuard } from "../auth/guards";

@Controller("users")
export class UsersController {
  constructor(private usersService: UsersService) {}

  @UseGuards(CookieAuthGuard)
  @Put("update/basic-info")
  async updateBasicInfo(@Body() dto: UpdateUserDto, @CurrentUser() user: User) {
    const updated = await this.usersService.update(user.id, dto);
    return { success: true, user: updated };
  }
}
