import { Body, Controller, Patch, UseGuards } from "@nestjs/common";
import { UpdateUserDto } from "./dto/update-user.dto";
import { UsersService } from "./users.service";
import { CurrentUser } from "./decorators/current-user.decorator";
import type { User } from "../../generated/prisma";
import { CookieAuthGuard } from "../auth/guards";

@Controller("users")
export class UsersController {
  constructor(private usersService: UsersService) {}

  @UseGuards(CookieAuthGuard)
  @Patch("update/basic-info")
  async updateBasicInfo(@Body() dto: UpdateUserDto, @CurrentUser() user: User) {
    const updated = await this.usersService.update(user.id, dto);
    return { success: true, data: updated };
  }
}
