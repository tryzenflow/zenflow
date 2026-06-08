import { Controller, Get, UseGuards } from "@nestjs/common";
import { TagsService } from "./tags.service";
import { CookieAuthGuard } from "../auth/guards";
import { CurrentUser } from "../users/decorators/current-user.decorator";
import { type User } from "../../generated/prisma";

@Controller("tags")
@UseGuards(CookieAuthGuard)
export class TagsController {
  constructor(private readonly tagsService: TagsService) {}

  @Get()
  async list(@CurrentUser() user: User) {
    const data = await this.tagsService.list(user);
    return {
      success: true,
      message: `Found ${data.tags.length} tags`,
      data,
    };
  }
}
