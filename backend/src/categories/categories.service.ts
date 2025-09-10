import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { CreateCategoryDto } from "./dto/create-category.dto";
import { UpdateCategoryDto } from "./dto/update-category.dto";
import { PrismaService } from "../prisma/prisma.service";
import { Prisma } from "../../generated/prisma";
import { PostgresErrorCode } from "../prisma/error-codes";

@Injectable()
export class CategoriesService {
  constructor(private prisma: PrismaService) {}

  async initDefault(userId: string) {
    const defaultCategories = [
      "💼 Work / Study",
      "💪 Health & Fitness",
      "🍽️ Meals",
      "👨‍👩‍👧 Personal / Family",
      "🧹 Chores / Errands",
      "🎮 Leisure",
      "😴 Rest",
    ];
    await this.prisma.category.createMany({
      data: defaultCategories.map((c) => ({ name: c, userId })),
      skipDuplicates: true,
    });
  }

  async create(createCategoryDto: CreateCategoryDto, userId: string) {
    const newCategory = await this.prisma.category.create({
      data: { ...createCategoryDto, userId },
    });
    return newCategory;
  }

  async findAll(userId: string) {
    const categories = await this.prisma.category.findMany({
      where: { userId },
    });
    return categories;
  }

  async update(
    id: string,
    updateCategoryDto: UpdateCategoryDto,
    userId: string
  ) {
    try {
      const updated = await this.prisma.category.update({
        where: { id },
        data: { ...updateCategoryDto, userId },
      });
      return updated;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === PostgresErrorCode.RecordNotFound)
          throw new NotFoundException();
      }
      throw new InternalServerErrorException();
    }
  }

  async remove(id: string, userId: string) {
    try {
      await this.prisma.category.delete({
        where: { id, userId },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === PostgresErrorCode.RecordNotFound)
          throw new NotFoundException();
      }
      throw new InternalServerErrorException();
    }
  }
}
