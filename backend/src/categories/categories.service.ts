import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { CreateCategoryDto } from "./dto/create-category.dto";
import { UpdateCategoryDto } from "./dto/update-category.dto";
import { PrismaService } from "../prisma/prisma.service";
import { Prisma } from "../../generated/prisma";
import { PostgresErrorCode } from "../prisma/error-codes";
import { PopulateCategoriesDto } from "./dto/populate-categories.dto";
import { ORDER_GAP } from "../common/constants";

@Injectable()
export class CategoriesService {
  constructor(private prisma: PrismaService) {}

  async populate(userId: string, { categories }: PopulateCategoriesDto) {
    const existingCategoriesCount = await this.prisma.category.count({
      where: { userId },
    });
    if (existingCategoriesCount > 0) {
      throw new BadRequestException({
        success: false,
        message: "Categories already populated",
      });
    }
    const newCategories = await this.prisma.category.createManyAndReturn({
      data: categories.map(({ name }, i) => ({
        name,
        userId,
        order: i * ORDER_GAP,
      })),
      select: { id: true, name: true },
      skipDuplicates: true,
    });
    return newCategories;
  }

  async create(createCategoryDto: CreateCategoryDto, userId: string) {
    try {
      const maxOrder = await this.prisma.category.aggregate({
        where: { userId },
        _max: { order: true },
      });
      const newCategory = await this.prisma.category.create({
        data: {
          ...createCategoryDto,
          userId,
          order: (maxOrder._max.order || 0) + ORDER_GAP,
        },
      });
      return newCategory;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError)
        if (error.code === PostgresErrorCode.UniqueConstraintViolation)
          throw new BadRequestException({
            success: false,
            message: `Category "${createCategoryDto.name}" already exists`,
          });
    }
  }

  async findAll(userId: string) {
    const categories = await this.prisma.category.findMany({
      where: { userId },
      orderBy: { order: "asc" },
    });
    return categories;
  }

  async update(
    id: string,
    { beforeId, afterId, ...updateCategoryDto }: UpdateCategoryDto,
    userId: string
  ) {
    try {
      let beforeOrder: number = 0;
      let afterOrder: number;

      if (beforeId) {
        const beforeCategory = await this.prisma.category.findUniqueOrThrow({
          where: { id: beforeId, userId },
        });
        beforeOrder = beforeCategory.order;
      }

      if (afterId) {
        const afterCategory = await this.prisma.category.findUniqueOrThrow({
          where: { id: afterId, userId },
        });
        afterOrder = afterCategory.order;
      } else {
        const maxOrder = await this.prisma.category.aggregate({
          where: { userId },
          _max: { order: true },
        });
        afterOrder = (maxOrder._max.order || 0) + ORDER_GAP;
      }

      const updated = await this.prisma.category.update({
        where: { id },
        data: {
          ...updateCategoryDto,
          userId,
          order: (afterOrder + beforeOrder) / 2,
        },
      });
      return updated;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === PostgresErrorCode.UniqueConstraintViolation)
          throw new BadRequestException({
            success: false,
            message: `Category "${updateCategoryDto.name}" already exists`,
          });
        if (error.code === PostgresErrorCode.RecordNotFound)
          throw new NotFoundException();
      }
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
          throw new NotFoundException({
            success: false,
            message: "Category not found",
          });
      }
    }
  }
}
