import {
  BadRequestException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "../../generated/prisma";
import { PostgresErrorCode } from "../prisma/error-codes";
import { PrismaService } from "../prisma/prisma.service";
import { CreateUserDto } from "./dto/create-user.dto";
import { UpdateUserDto } from "./dto/update-user.dto";
import { UserPreferencesService } from "../prefs/prefs.service";
import { DAY_OF_WEEK } from "src/common/constants";
import { defaultPref } from "src/prefs/utils";
import { CategoriesService } from "src/categories/categories.service";
import { defaultCategories } from "src/categories/utils";

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private userPreferencesService: UserPreferencesService,
    private categoriesService: CategoriesService,
  ) {}

  async create(createUserDto: CreateUserDto) {
    const newUser = await this.prisma.$transaction(async (tx) => {
      try {
        const newUser = await tx.user.create({
          data: { ...createUserDto, name: "New User" },
        });
        await this.userPreferencesService.populate(
          Array(DAY_OF_WEEK)
            .fill(null)
            .map((_, i) => ({ ...defaultPref, day: i })),
          newUser.id,
          tx,
        );
        await this.categoriesService.populate(
          newUser.id,
          defaultCategories,
          tx,
        );
        return newUser;
      } catch (error) {
        console.error(error);
        if (error instanceof HttpException) throw error;
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          if (error.code === PostgresErrorCode.UniqueConstraintViolation)
            throw new BadRequestException("Email already exists");
        }

        throw new InternalServerErrorException();
      }
    });
    return newUser;
  }

  async update(id: string, updateUserDto: UpdateUserDto) {
    try {
      const updated = await this.prisma.user.update({
        where: { id },
        data: updateUserDto,
      });
      return updated;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === PostgresErrorCode.RecordNotFound)
          throw new NotFoundException("Cannot find user with the given id");
      }
      throw new InternalServerErrorException();
    }
  }

  async findByEmail(email: string) {
    try {
      const user = await this.prisma.user.findUnique({
        where: { email },
      });
      return user;
    } catch (error: any) {
      throw new InternalServerErrorException();
    }
  }

  async remove(id: string) {
    try {
      await this.prisma.user.delete({ where: { id } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError)
        if (error.code === PostgresErrorCode.RecordNotFound)
          throw new NotFoundException("User with that id does not exist");

      throw new InternalServerErrorException();
    }
  }

  async findById(id: string) {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id },
      });
      return user;
    } catch (error: any) {
      throw new InternalServerErrorException();
    }
  }
}
