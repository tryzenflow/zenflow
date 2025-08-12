import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { faker } from "@faker-js/faker";
import { Prisma } from "../../generated/prisma";
import { PostgresErrorCode } from "../prisma/error-codes";
import { PrismaService } from "../prisma/prisma.service";
import { CreateUserDto, UpdateUserDto } from "./dto";

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async create(createUserDto: CreateUserDto) {
    try {
      const newUser = await this.prisma.user.create({
        data: { ...createUserDto, name: faker.internet.displayName() },
      });
      return newUser;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === PostgresErrorCode.UniqueConstraintViolation)
          throw new BadRequestException("Email already exists");
      }

      throw new InternalServerErrorException();
    }
  }

  async updateName(id: number, { name }: UpdateUserDto) {
    try {
      const updated = await this.prisma.user.update({
        where: { id },
        data: { name },
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
    const user = await this.prisma.user.findUnique({
      where: { email },
    });
    return user;
  }

  async remove(id: number) {
    try {
      await this.prisma.user.delete({ where: { id } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError)
        if (error.code === PostgresErrorCode.RecordNotFound)
          throw new NotFoundException("User with that id does not exist");

      throw new InternalServerErrorException();
    }
  }

  async findById(id: number) {
    try {
      const user = await this.prisma.user.findUniqueOrThrow({
        where: { id },
      });
      return user;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError)
        if (error.code === PostgresErrorCode.RecordNotFound)
          throw new NotFoundException("Cannot find user with the given id");
      throw new InternalServerErrorException();
    }
  }
}
