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
import { workWindowMinutes } from "../scheduler/utils/slot";
import { CreateUserDto } from "./dto/create-user.dto";
import { UpdateUserDto } from "./dto/update-user.dto";
import { UpdatePreferencesDto } from "./dto/update-preferences.dto";
import { OnboardingDto } from "./dto/onboarding.dto";
import {
  PREFERENCE_MATRIX_LENGTH,
  PREFERENCE_SLOTS_PER_DAY,
  type PreferenceMatrixResponse,
  type TagBiasResponse,
} from "@zenflow/shared";

/** Minimum length of the working window, in minutes (docs invariant). */
const MIN_WORKDAY_MINUTES = 60;

/** Day rows in the signed preference matrix (7 ISO weekdays). */
const PREFERENCE_MATRIX_DAYS =
  PREFERENCE_MATRIX_LENGTH / PREFERENCE_SLOTS_PER_DAY;

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
    // A window wraps past midnight iff workEnd <= workStart; an equal start/end
    // is a zero-length / ambiguous-24h window and is always rejected.
    if (workStart === workEnd)
      throw new BadRequestException("Working window cannot be empty");
    if (workWindowMinutes(workStart, workEnd) < MIN_WORKDAY_MINUTES)
      throw new BadRequestException("Working window must be at least 1 hour");
  }

  /**
   * Update the user's work schedule + scheduling preferences. Metadata-only —
   * it does NOT cascade-reschedule existing tasks (not requested by
   * todo.md); the frontend's own confirm-before-reschedule flows own that.
   */
  async updatePreferences(user: User, dto: UpdatePreferencesDto) {
    this.assertValidWindow(dto.workStart, dto.workEnd);
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        workStart: dto.workStart,
        workEnd: dto.workEnd,
        workDays: dto.workDays,
        timezone: dto.timezone,
        // The duration-adjustment mode is a partial update: only write it when
        // explicitly sent so omitting it preserves the existing value.
        ...(dto.durationAdjustmentMode !== undefined
          ? { durationAdjustmentMode: dto.durationAdjustmentMode }
          : {}),
      },
    });
    return updated;
  }

  /** Complete onboarding: set the schedule and the completion flag. */
  async completeOnboarding(user: User, dto: OnboardingDto) {
    this.assertValidWindow(dto.workStart, dto.workEnd);
    return this.prisma.user.update({
      where: { id: user.id },
      data: {
        workStart: dto.workStart,
        workEnd: dto.workEnd,
        workDays: dto.workDays,
        timezone: dto.timezone,
        // Onboarding may set the mode; default 'auto' (the schema default) when
        // the client doesn't send it.
        ...(dto.durationAdjustmentMode !== undefined
          ? { durationAdjustmentMode: dto.durationAdjustmentMode }
          : {}),
        onboardingComplete: true,
      },
    });
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

  /**
   * Return per-tag duration multipliers for the user, sorted by sample count
   * descending (most-used tag first). Delegates the aggregation to
   * `SchedulerService.aggregateTagBias` — the single source of truth for this
   * COMPLETE/KEEP `TaskEvent` query, also used by
   * `SchedulerService.computeDurationCorrection` — scoped here to ALL of the
   * user's tags rather than a specific task's tags. Tags with zero samples are
   * omitted.
   */
  async getUserTagBias(user: User): Promise<TagBiasResponse> {
    const tagRows = await this.prisma.tag.findMany({
      where: { userId: user.id },
      select: { name: true },
    });
    if (tagRows.length === 0) return { tags: [] };

    const perTag = await this.scheduler.aggregateTagBias(
      user.id,
      tagRows.map((r) => r.name),
    );

    const result = [...perTag.entries()]
      .map(([tag, { n, b }]) => ({ tag, n, b }))
      .sort((a, b) => b.n - a.n);

    return { tags: result };
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
