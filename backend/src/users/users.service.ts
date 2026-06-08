import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, type User } from "../../generated/prisma";
import { PostgresErrorCode } from "../prisma/error-codes";
import { PrismaService } from "../prisma/prisma.service";
import { SchedulerService } from "../scheduler/scheduler.service";
import { CreateUserDto } from "./dto/create-user.dto";
import { UpdateUserDto } from "./dto/update-user.dto";
import { UpdatePreferencesDto } from "./dto/update-preferences.dto";
import { OnboardingDto } from "./dto/onboarding.dto";

/** Minimum length of the working window, in minutes (docs invariant). */
const MIN_WORKDAY_MINUTES = 60;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scheduler: SchedulerService,
  ) {}

  async create(createUserDto: CreateUserDto) {
    try {
      // Working-window and penalty-matrix defaults come from the Prisma schema.
      return await this.prisma.user.create({
        data: { ...createUserDto, name: "New User" },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === PostgresErrorCode.UniqueConstraintViolation
      )
        throw new BadRequestException("Email already exists");
      throw new InternalServerErrorException();
    }
  }

  async update(id: string, updateUserDto: UpdateUserDto) {
    try {
      return await this.prisma.user.update({
        where: { id },
        data: updateUserDto,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === PostgresErrorCode.RecordNotFound
      )
        throw new NotFoundException("Cannot find user with the given id");
      throw new InternalServerErrorException();
    }
  }

  private assertValidWindow(workStart: number, workEnd: number) {
    if (workStart >= workEnd)
      throw new BadRequestException("workStart must be before workEnd");
    if (workEnd - workStart < MIN_WORKDAY_MINUTES)
      throw new BadRequestException("Working window must be at least 1 hour");
  }

  /** Update the work schedule, then full-re-EDF all PENDING tasks. */
  async updatePreferences(user: User, dto: UpdatePreferencesDto) {
    this.assertValidWindow(dto.workStart, dto.workEnd);
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        workStart: dto.workStart,
        workEnd: dto.workEnd,
        workDays: dto.workDays,
        timezone: dto.timezone,
        // Only touch the archetype when the caller explicitly sent the key,
        // so an update that omits it does not wipe an existing value.
        ...("roleArchetypeId" in dto
          ? { roleArchetypeId: dto.roleArchetypeId ?? null }
          : {}),
      },
    });
    await this.scheduler.rescheduleAll(updated);
    return updated;
  }

  /** Complete onboarding: set the schedule, archetype, and the completion flag. */
  async completeOnboarding(user: User, dto: OnboardingDto) {
    this.assertValidWindow(dto.workStart, dto.workEnd);
    return this.prisma.user.update({
      where: { id: user.id },
      data: {
        workStart: dto.workStart,
        workEnd: dto.workEnd,
        workDays: dto.workDays,
        timezone: dto.timezone,
        roleArchetypeId: dto.roleArchetypeId ?? null,
        onboardingComplete: true,
      },
    });
  }

  async findByEmail(email: string) {
    try {
      return await this.prisma.user.findUnique({ where: { email } });
    } catch {
      throw new InternalServerErrorException();
    }
  }

  async findById(id: string) {
    try {
      return await this.prisma.user.findUnique({ where: { id } });
    } catch {
      throw new InternalServerErrorException();
    }
  }

  async remove(id: string) {
    try {
      await this.prisma.user.delete({ where: { id } });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === PostgresErrorCode.RecordNotFound
      )
        throw new NotFoundException("User with that id does not exist");
      throw new InternalServerErrorException();
    }
  }
}
