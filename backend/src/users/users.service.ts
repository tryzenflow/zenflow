import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, type User } from "../../generated/prisma";
import { PostgresErrorCode } from "../prisma/error-codes";
import { PrismaService } from "../prisma/prisma.service";
import { CreateUserDto } from "./dto/create-user.dto";
import { UpdateUserDto } from "./dto/update-user.dto";
import {
  PREFERENCE_MATRIX_LENGTH,
  PREFERENCE_SLOTS_PER_DAY,
  type PreferenceMatrixResponse,
} from "@zenflow/shared";

/** Day rows in the signed preference matrix (7 ISO weekdays). */
const PREFERENCE_MATRIX_DAYS =
  PREFERENCE_MATRIX_LENGTH / PREFERENCE_SLOTS_PER_DAY;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createUserDto: CreateUserDto) {
    try {
      // Penalty-matrix defaults come from the Prisma schema. There's no
      // onboarding flow left to gate on, so every new user starts
      // `onboardingComplete: true` at the application layer — the schema's
      // own `@default(false)` is intentionally overridden here rather than
      // dropped in a migration (out of scope for this change; the column
      // itself is left alone pending explicit sign-off on a real migration).
      return await this.prisma.user.create({
        data: { ...createUserDto, name: "New User", onboardingComplete: true },
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

  /**
   * The current user's flat 168-element float SIGNED preference matrix for the
   * Insights heatmap (fetch-on-open). Values are floats (not integers) because
   * the daily exponential decay accumulates sub-integer precision. A cold-start
   * / wrong-length matrix is normalised to all-zero so the FE never has to
   * special-case the length. Read-only.
   */
  async getPreferenceMatrix(user: User): Promise<PreferenceMatrixResponse> {
    const matrix =
      user.preferenceMatrix.length === PREFERENCE_MATRIX_LENGTH
        ? user.preferenceMatrix
        : new Array<number>(PREFERENCE_MATRIX_LENGTH).fill(0);
    return {
      matrix,
      days: PREFERENCE_MATRIX_DAYS,
      blocks: PREFERENCE_SLOTS_PER_DAY,
    };
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
