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
import { workWindowMinutes } from "../scheduler/slot";
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
        // Likewise the duration-adjustment mode is a partial update: only write
        // it when explicitly sent so omitting it preserves the existing value.
        ...(dto.durationAdjustmentMode !== undefined
          ? { durationAdjustmentMode: dto.durationAdjustmentMode }
          : {}),
      },
    });
    // A work-hours/timezone change can invalidate every current placement, so
    // re-EDF the full PENDING set. This is a background recompute with no
    // "current calendar view" to bound the blast radius to (unlike the
    // create/edit-in-view cascades), so it deliberately runs UNSCOPED (no view
    // bounds) — the one documented exception to the view-scoped cascade rule.
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
   * descending (most-used tag first). Aggregates COMPLETE/KEEP `TaskEvent` rows
   * for all of the user's tags using the same telemetry query pattern as
   * `SchedulerService.aggregateTagBias` — but scoped to ALL user tags rather
   * than a specific task's tags. Tags with zero samples are omitted.
   */
  async getUserTagBias(user: User): Promise<TagBiasResponse> {
    const tagRows = await this.prisma.tag.findMany({
      where: { userId: user.id },
      select: { name: true },
    });
    if (tagRows.length === 0) return { tags: [] };

    const wanted = new Set(tagRows.map((r) => r.name));

    // Pull recent outcome events for this user. Pair each COMPLETE/KEEP (actual
    // duration) with the matching CREATE (estimated duration) by taskId.
    const events = await this.prisma.taskEvent.findMany({
      where: {
        userId: user.id,
        eventType: { in: ["CREATE", "COMPLETE", "KEEP"] },
      },
      select: {
        taskId: true,
        eventType: true,
        newSnapshot: true,
      },
      orderBy: { occurredAt: "desc" },
      take: 2000,
    });

    type Snap = { durationMinutes?: number; tags?: string[] };
    const estimateByTask = new Map<string, number>();
    const outcomes: { taskId: string; duration: number; tags: string[] }[] = [];

    for (const e of events) {
      const snap = (e.newSnapshot ?? {}) as Snap;
      const dur =
        typeof snap.durationMinutes === "number" ? snap.durationMinutes : null;
      const tags = Array.isArray(snap.tags) ? snap.tags : [];
      if (dur === null) continue;
      if (e.eventType === "CREATE") {
        if (!estimateByTask.has(e.taskId)) estimateByTask.set(e.taskId, dur);
      } else {
        outcomes.push({ taskId: e.taskId, duration: dur, tags });
      }
    }

    // Accumulate actual÷estimated ratio per tag.
    const acc = new Map<string, { sum: number; n: number }>();
    for (const o of outcomes) {
      const estimated = estimateByTask.get(o.taskId);
      if (!estimated || estimated <= 0) continue;
      const ratio = o.duration / estimated;
      for (const tag of o.tags) {
        if (!wanted.has(tag)) continue;
        const cur = acc.get(tag) ?? { sum: 0, n: 0 };
        cur.sum += ratio;
        cur.n += 1;
        acc.set(tag, cur);
      }
    }

    const result = [...acc.entries()]
      .filter(([, { n }]) => n > 0)
      .map(([tag, { sum, n }]) => ({ tag, n, b: sum / n }))
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
