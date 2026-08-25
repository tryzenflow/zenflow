import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import type {
  CreateSessionResponse,
  RemoveSessionResponse,
  Session as SharedSession,
  SessionDetailResponse,
  SessionSuggestionsResponse,
  SessionsListResponse,
  UpdateSessionResponse,
} from "@zenflow/shared";
import { Prisma, type User } from "../../generated/prisma";
import { minutesToUtc } from "../common/utils";
import { PostgresErrorCode } from "../prisma/error-codes";
import { PrismaService } from "../prisma/prisma.service";
import { CreateSessionDto } from "./dto/create-session.dto";
import { displayDayRange } from "../scheduler/utils/horizon";
import { localDateStr } from "../scheduler/utils/slot";
import { DayRescheduleService } from "../scheduler/day-reschedule.service";
import { ListSessionSuggestionsDto } from "./dto/list-session-suggestions.dto";
import { ListSessionsDto } from "./dto/list-sessions.dto";
import { UpdateSessionDto } from "./dto/update-session.dto";
import { TagsService } from "../tags/tags.service";
import { SessionWithTags } from "./types";

@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tagsService: TagsService,
    private readonly dayRescheduleService: DayRescheduleService,
  ) {}

  /** Map a Prisma row to the shared API shape (dates → ISO strings). */
  private toDto(session: SessionWithTags): SharedSession {
    return {
      id: session.id,
      title: session.title,
      note: session.note,
      durationMinutes: session.durationMinutes,
      deadline: session.deadline.toISOString(),
      // The wire format stays a string[] of tag NAMES; sort for stable output.
      tags: session.tags.map((t) => t.name).sort((a, b) => a.localeCompare(b)),
      status: session.status,
      scheduledStartTime: session.scheduledStartTime
        ? session.scheduledStartTime.toISOString()
        : null,
      createdAt: session.createdAt.toISOString(),
      updatedAt: session.updatedAt.toISOString(),
    };
  }

  async create(
    dto: CreateSessionDto,
    user: User,
  ): Promise<CreateSessionResponse> {
    const cleanTags = (dto.tags ?? []).map((t) => t.trim()).filter(Boolean);

    const created = await this.prisma.$transaction(
      async (tx): Promise<SessionWithTags> => {
        const tagIds = await this.tagsService.resolveTagIds(
          tx,
          user.id,
          cleanTags,
        );
        return tx.session.create({
          data: {
            title: dto.title,
            note: dto.note ?? null,
            durationMinutes: dto.durationMinutes,
            deadline: new Date(dto.deadline),
            tags: { connect: tagIds.map((id) => ({ id })) },
            userId: user.id,
          },
          include: { tags: true },
        });
      },
    );

    // Creating a session implicitly repacks the calendar day its deadline
    // falls on — no preview, no undo (replaces the old manual "Optimize").
    const dayReschedule = await this.dayRescheduleService.rescheduleDay(
      user.id,
      localDateStr(created.deadline, user.timezone),
      user.timezone,
      user.preferenceMatrix,
      new Date(),
    );

    return { ...this.toDto(created), dayReschedule };
  }

  async list(dto: ListSessionsDto, user: User): Promise<SessionsListResponse> {
    const tz = user.timezone;
    const { startStr: displayStartStr, endStr: displayEndStr } =
      displayDayRange(dto.view, dto.date);
    const displayStart = minutesToUtc(displayStartStr, 0, tz);
    const displayEnd = minutesToUtc(displayEndStr, 1439, tz);

    const where: Prisma.SessionWhereInput = {
      userId: user.id,
      OR: [
        { scheduledStartTime: null },
        { scheduledStartTime: { gte: displayStart, lte: displayEnd } },
      ],
    };
    const sessions = await this.prisma.session.findMany({
      where,
      include: { tags: true },
    });

    return { sessions: sessions.map((t) => this.toDto(t)) };
  }

  async suggestions(
    dto: ListSessionSuggestionsDto,
    user: User,
  ): Promise<SessionSuggestionsResponse> {
    const limit = dto.limit ?? 10;
    const q = dto.q?.trim();

    const where: Prisma.SessionWhereInput = { userId: user.id };
    if (q) where.title = { contains: q, mode: "insensitive" };

    const rows = await this.prisma.session.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: { tags: true },
      take: limit,
    });

    return { suggestions: rows.map((r) => this.toDto(r)) };
  }

  async findById(id: string, user: User): Promise<SessionDetailResponse> {
    const session = await this.prisma.session.findUnique({
      where: { id, userId: user.id },
      include: { tags: true },
    });
    if (!session)
      throw new NotFoundException(`Cannot find session with id ${id}`);

    return this.toDto(session);
  }

  async update(
    id: string,
    dto: UpdateSessionDto,
    user: User,
  ): Promise<UpdateSessionResponse> {
    try {
      let newDeadline: Date | null = null;

      const updated = await this.prisma.$transaction(
        async (tx): Promise<SessionWithTags> => {
          const existing = await tx.session.findFirst({
            where: { id, userId: user.id },
          });
          if (!existing)
            throw new NotFoundException(`Cannot find session with id ${id}`);

          const data: Prisma.SessionUpdateInput = {};
          if (dto.title !== undefined) data.title = dto.title;
          if (dto.note !== undefined) data.note = dto.note;
          if (dto.durationMinutes !== undefined)
            data.durationMinutes = dto.durationMinutes;
          if (dto.deadline !== undefined) {
            const candidate = new Date(dto.deadline);
            if (candidate.getTime() !== existing.deadline.getTime()) {
              newDeadline = candidate;
            }
            data.deadline = candidate;
          }
          if (dto.scheduledStartTime !== undefined)
            data.scheduledStartTime = dto.scheduledStartTime
              ? new Date(dto.scheduledStartTime)
              : null;
          if (dto.status !== undefined) data.status = dto.status;
          if (dto.tags !== undefined) {
            const cleanTags = dto.tags.map((t) => t.trim()).filter(Boolean);
            const tagIds = await this.tagsService.resolveTagIds(
              tx,
              user.id,
              cleanTags,
            );
            data.tags = { set: tagIds.map((tagId) => ({ id: tagId })) };
          }

          return tx.session.update({
            where: { id },
            data,
            include: { tags: true },
          });
        },
      );

      // Only a genuine deadline change triggers an implicit repack — other
      // edits (title/note/duration/status/tags/manual drag) are plain writes.
      const dayReschedule = newDeadline
        ? await this.dayRescheduleService.rescheduleDay(
            user.id,
            localDateStr(newDeadline, user.timezone),
            user.timezone,
            user.preferenceMatrix,
            new Date(),
          )
        : undefined;

      return { ...this.toDto(updated), dayReschedule };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === (PostgresErrorCode.RecordNotFound as string)
      )
        throw new NotFoundException(`Cannot find session with id ${id}`);
      console.error(
        "[ERROR] service=sessions, method=update, message=Something went wrong when updating a session",
      );
      throw new InternalServerErrorException({
        success: false,
        message: "Something went wrong when updating a session",
      });
    }
  }

  async remove(id: string, user: User): Promise<RemoveSessionResponse> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const existing = await tx.session.findFirst({
          where: { id, userId: user.id },
        });
        if (!existing)
          throw new NotFoundException(`Cannot find session with id ${id}`);
        await tx.session.delete({ where: { id, userId: user.id } });
        return { id };
      });
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === (PostgresErrorCode.RecordNotFound as string)
      )
        throw new NotFoundException(`Cannot find session with id ${id}`);
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `[ERROR] service=sessions, method=remove, message="${message}"`,
      );
      throw new InternalServerErrorException({
        success: false,
        message: "Something went wrong when deleting a session",
      });
    }
  }
}
