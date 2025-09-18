import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { CreateCategoryDto } from "./dto/create-category.dto";
import { UpdateCategoryDto } from "./dto/update-category.dto";
import { PrismaService } from "../prisma/prisma.service";
import { Prisma } from "../../generated/prisma";
import { PostgresErrorCode } from "../prisma/error-codes";
import { PopulateCategoriesDto } from "./dto/populate-categories.dto";

@Injectable()
export class CategoriesService {
  constructor(private prisma: PrismaService) {}

  async populateCategories(
    userId: string,
    { categories }: PopulateCategoriesDto
  ) {
    const newCategories = await this.prisma.category.createManyAndReturn({
      data: categories.map(({ name }) => ({ name, userId })),
      select: { id: true, name: true },
      skipDuplicates: true,
    });
    return newCategories;
  }

  async create(createCategoryDto: CreateCategoryDto, userId: string) {
    try {
      const newCategory = await this.prisma.category.create({
        data: { ...createCategoryDto, userId },
      });
      return newCategory;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError)
        if (error.code === PostgresErrorCode.UniqueConstraintViolation)
          throw new BadRequestException(
            `Category "${createCategoryDto.name}" already exists`
          );
      throw new InternalServerErrorException();
    }
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
        if (error.code === PostgresErrorCode.UniqueConstraintViolation)
          throw new BadRequestException(
            `Category "${updateCategoryDto.name}" already exists`
          );
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
