import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Put,
  UseGuards,
} from "@nestjs/common";
import { CookieAuthGuard } from "../auth/guards";
import { CurrentUser } from "../users/decorators/current-user.decorator";
import type { User } from "../../generated/prisma";
import { UpdateCourseColourDto } from "./dto/update-course-colour.dto";
import { CourseColoursService } from "./course-colours.service";

@Controller("course-colours")
@UseGuards(CookieAuthGuard)
export class CourseColoursController {
  constructor(private readonly courseColours: CourseColoursService) {}

  @Get()
  async list(@CurrentUser() user: User) {
    const data = await this.courseColours.list(user);
    return {
      success: true,
      message: `Found ${data.colours.length} course colours`,
      data,
    };
  }

  @Put(":courseKey")
  async set(
    @CurrentUser() user: User,
    @Param("courseKey") courseKey: string,
    @Body() dto: UpdateCourseColourDto,
  ) {
    const data = await this.courseColours.set(user, courseKey, dto.swatch);
    return { success: true, message: "Course colour saved", data };
  }

  @Delete(":courseKey")
  async reset(
    @CurrentUser() user: User,
    @Param("courseKey") courseKey: string,
  ) {
    const data = await this.courseColours.reset(user, courseKey);
    return { success: true, message: "Course colour reset", data };
  }
}
