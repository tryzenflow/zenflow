import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { CreateUserPreferenceDto } from "./dto/create-pref.dto";
import { UpdateUserPreferenceDto } from "./dto/update-pref.dto";
import { PrismaService } from "../prisma/prisma.service";
import { Prisma } from "../../generated/prisma";
import { PostgresErrorCode } from "../prisma/error-codes";
import { Transaction } from "src/common/types";

@Injectable()
export class UserPreferencesService {
  constructor(private prisma: PrismaService) {}

  async populate(
    createPrefsDto: CreateUserPreferenceDto[],
    userId: string,
    tx?: Transaction,
  ) {
    try {
      const create = createPrefsDto.map((dto) => async () => {
        await (tx ?? this.prisma).userPreference.create({
          data: {
            userId,
            day: dto.day,
            breakMinutes: dto.breakMinutes,
            energyZones: {
              createMany: {
                data: dto.energyZones.map(({ start, end, level }) => ({
                  start,
                  end,
                  level,
                })),
              },
            },
          },
        });
      });
      await Promise.all(create.map((fn) => fn()));
    } catch (error) {
      console.error(error);
      if (error instanceof Prisma.PrismaClientKnownRequestError)
        if (error.code === PostgresErrorCode.UniqueConstraintViolation)
          throw new BadRequestException({
            success: false,
            message: "Preference for the user on the day already exists",
          });
      throw new InternalServerErrorException({
        success: false,
        message: "Something went wrong when creating a new user preference",
      });
    }
  }

  async getByDay(userId: string, dayOfWeek: number) {
    const userPreference = await this.prisma.userPreference.findUnique({
      where: { userId_day: { userId, day: dayOfWeek } },
      include: {
        energyZones: {
          select: {
            start: true,
            end: true,
            level: true,
            id: true,
          },
          orderBy: { start: "asc" },
        },
      },
    });
    if (!userPreference) throw new NotFoundException();
    return userPreference;
  }

  async update(
    dayOfWeek: number,
    userId: string,
    { breakMinutes, energyZones }: UpdateUserPreferenceDto,
    tx?: Transaction,
  ) {
    const updated = await (tx ?? this.prisma).userPreference.update({
      where: { userId_day: { userId, day: dayOfWeek } },
      data: {
        breakMinutes,
        energyZones: energyZones
          ? {
              deleteMany: {},
              createMany: {
                data: energyZones.map(({ start, end, level }) => ({
                  start,
                  end,
                  level,
                })),
              },
            }
          : undefined,
      },
      include: {
        energyZones: {
          select: { start: true, end: true, level: true, id: true },
          orderBy: { start: "asc" },
        },
      },
    });
    return updated;
  }
}
