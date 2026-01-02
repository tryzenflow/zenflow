import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
} from "@nestjs/common";
import { CategoriesService } from "./categories.service";
import { CreateCategoryDto } from "./dto/create-category.dto";
import { UpdateCategoryDto } from "./dto/update-category.dto";
import { CookieAuthGuard } from "../auth/guards";
import { CurrentUser } from "../users/decorators/current-user.decorator";
import { type User } from "../../generated/prisma";

@Controller("categories")
@UseGuards(CookieAuthGuard)
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Post()
  async create(
    @Body() createCategoryDto: CreateCategoryDto,
    @CurrentUser() user: User,
  ) {
    const newCategory = await this.categoriesService.create(
      createCategoryDto,
      user.id,
    );
    return {
      success: true,
      data: newCategory,
    };
  }

  @Get()
  async findAll(@CurrentUser() user: User) {
    const categories = await this.categoriesService.findAll(user.id);
    return {
      success: true,
      data: categories,
    };
  }

  @Patch(":id")
  async update(
    @Param("id") id: string,
    @Body() updateCategoryDto: UpdateCategoryDto,
    @CurrentUser() user: User,
  ) {
    const updated = await this.categoriesService.update(
      id,
      updateCategoryDto,
      user.id,
    );
    return {
      success: true,
      data: updated,
    };
  }

  @Delete(":id")
  async remove(@Param("id") id: string, @CurrentUser() user: User) {
    await this.categoriesService.remove(id, user.id);
    return {
      success: true,
      message: "Category deleted successfully",
    };
  }
}
