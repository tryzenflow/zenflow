import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  UseGuards,
} from "@nestjs/common";
import { BulkCreateTagsDto } from "./dto/bulk-create-tags.dto";
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

  /** Idempotent bulk create (skips duplicates); used by onboarding. */
  @Post("bulk")
  @HttpCode(200)
  async bulkCreate(@CurrentUser() user: User, @Body() dto: BulkCreateTagsDto) {
    const data = await this.tagsService.bulkCreate(user, dto.names);
    return { success: true, message: `Ensured ${data.tags.length} tags`, data };
  }
}
