import { Body, Controller, Get, Patch, UseGuards } from "@nestjs/common";
import { UpdateUserDto } from "./dto/update-user.dto";
import { toUserResponse } from "./user-response";
import { StudentService } from "./student.service";
import { UsersService } from "./users.service";
import { CurrentUser } from "./decorators/current-user.decorator";
import type { User } from "../../generated/prisma";
import { CookieAuthGuard } from "../auth/guards";

@Controller("users")
@UseGuards(CookieAuthGuard)
export class UsersController {
  constructor(
    private usersService: UsersService,
    private studentService: StudentService,
  ) {}

  @Get("me")
  me(@CurrentUser() user: User) {
    return { success: true, data: toUserResponse(user) };
  }

  @Get("me/student")
  async student(@CurrentUser() user: User) {
    return { success: true, data: await this.studentService.profile(user.id) };
  }

  @Get("me/marks")
  async marks(@CurrentUser() user: User) {
    return { success: true, data: await this.studentService.marks(user.id) };
  }

  @Patch("update/basic-info")
  async updateBasicInfo(@Body() dto: UpdateUserDto, @CurrentUser() user: User) {
    const updated = await this.usersService.update(user.id, dto);
    return { success: true, data: toUserResponse(updated) };
  }

  @Get("me/preference-matrix")
  async preferenceMatrix(@CurrentUser() user: User) {
    const data = await this.usersService.getPreferenceMatrix(user);
    return { success: true, data };
  }
}
