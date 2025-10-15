import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "../../generated/prisma";
import { PostgresErrorCode } from "../prisma/error-codes";
import { PrismaService } from "../prisma/prisma.service";
import { CreateUserDto } from "./dto/create-user.dto";
import { UpdateUserDto } from "./dto/update-user.dto";

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async create(createUserDto: CreateUserDto) {
    try {
      const newUser = await this.prisma.user.create({
        data: { ...createUserDto, timezone: "Europe/Paris", name: "New User" },
      });
      return { ...newUser, _count: { categories: 0, constraints: 0 } };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === PostgresErrorCode.UniqueConstraintViolation)
          throw new BadRequestException("Email already exists");
      }

      throw new InternalServerErrorException();
    }
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
        include: {
          _count: { select: { categories: true, constraints: true } },
        },
      });
      return user;
    } catch (error) {
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
        include: {
          _count: { select: { categories: true, constraints: true } },
        },
      });
      return user;
    } catch (error) {
      throw new InternalServerErrorException();
    }
  }
}
