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
import { langToDb } from "./user-response";
import { UpdateUserDto } from "./dto/update-user.dto";
import { remapExdatesForTimezone } from "../scheduler/core/recurrence";
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
      // The per-(user, provider) UserEncryptionKey is provisioned lazily on the
      // first `POST /integrations` for that provider (see IntegrationsService),
      // not here — a user who never connects a DLU account never gets one.
      return await this.prisma.user.create({
        data: { ...createUserDto, name: "New User" },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === (PostgresErrorCode.UniqueConstraintViolation as string)
      )
        throw new BadRequestException("Email already exists");
      throw new InternalServerErrorException();
    }
  }

  async update(id: string, updateUserDto: UpdateUserDto) {
    const { onboarded, seenTip, ...rest } = updateUserDto;
    try {
      if (onboarded) {
        // Idempotent: only the first completion stamps the time.
        await this.prisma.user.updateMany({
          where: { id, onboardedAt: null },
          data: { onboardedAt: new Date() },
        });
      }
      if (seenTip) {
        // Atomic and idempotent: only appends when the id isn't already there.
        await this.prisma.user.updateMany({
          where: { id, NOT: { seenTips: { has: seenTip } } },
          data: { seenTips: { push: seenTip } },
        });
      }
      const userUpdate = this.prisma.user.update({
        where: { id },
        data: {
          ...rest,
          lang: updateUserDto.lang ? langToDb(updateUserDto.lang) : undefined,
        },
      });
      const seriesUpdates = await this.exdateRemaps(id, updateUserDto.timezone);
      if (seriesUpdates.length === 0) return await userUpdate;
      const results = await this.prisma.$transaction([
        ...seriesUpdates,
        userUpdate,
      ]);
      return results[results.length - 1] as Awaited<typeof userUpdate>;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === (PostgresErrorCode.RecordNotFound as string)
      )
        throw new NotFoundException("Cannot find user with the given id");
      throw new InternalServerErrorException();
    }
  }

  /**
   * Series updates that re-key `exdates` for a timezone change, so occurrences
   * the user deleted individually don't reappear when the zone's offset (or
   * DST) moves their UTC instant. Empty when the zone is unchanged.
   */
  private async exdateRemaps(userId: string, newTz: string | undefined) {
    if (!newTz) return [];
    const current = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    if (!current || current.timezone === newTz) return [];
    const reps = await this.prisma.session.findMany({
      where: {
        userId,
        seriesId: { not: null },
        series: { exdates: { isEmpty: false } },
      },
      select: {
        seriesId: true,
        scheduledStartTime: true,
        series: { select: { exdates: true } },
      },
      orderBy: { createdAt: "asc" },
      distinct: ["seriesId"],
    });
    return reps.flatMap((r) =>
      r.seriesId && r.scheduledStartTime && r.series
        ? [
            this.prisma.sessionSeries.update({
              where: { id: r.seriesId },
              data: {
                exdates: remapExdatesForTimezone(
                  r.series.exdates,
                  r.scheduledStartTime,
                  current.timezone,
                  newTz,
                ),
              },
            }),
          ]
        : [],
    );
  }

  /**
   * The current user's flat 168-element float SIGNED preference matrix for the
   * Insights heatmap (fetch-on-open). Values are floats (not integers) because
   * the daily exponential decay accumulates sub-integer precision. A cold-start
   * / wrong-length matrix is normalised to all-zero so the FE never has to
   * special-case the length. Read-only.
   */
  getPreferenceMatrix(user: User): Promise<PreferenceMatrixResponse> {
    const matrix =
      user.preferenceMatrix.length === PREFERENCE_MATRIX_LENGTH
        ? user.preferenceMatrix
        : new Array<number>(PREFERENCE_MATRIX_LENGTH).fill(0);
    return Promise.resolve({
      matrix,
      days: PREFERENCE_MATRIX_DAYS,
      blocks: PREFERENCE_SLOTS_PER_DAY,
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
        error.code === (PostgresErrorCode.RecordNotFound as string)
      )
        throw new NotFoundException("User with that id does not exist");
      throw new InternalServerErrorException();
    }
  }
}
