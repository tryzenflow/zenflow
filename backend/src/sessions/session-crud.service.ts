import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  CreateSessionResponse,
  RemoveSessionResponse,
  Session as SharedSession,
  SessionDetailResponse,
  SessionSuggestionsResponse,
  SessionsListResponse,
} from "@zenflow/shared";
import { Prisma, type User } from "../../generated/prisma";
import { minutesToUtc } from "../common/utils";
import { PrismaService } from "../prisma/prisma.service";
import { TagsService } from "../tags/tags.service";
import { TaskPlacementService } from "../scheduler/io/task-placement.service";
import { displayDayRange } from "../scheduler/core/horizon";
import {
  expandRrule,
  firstOccurrence,
  occurrenceId,
  parseOccurrenceId,
} from "../scheduler/core/recurrence";
import { DAY_MS } from "../scheduler/core/slot";
import { CreateSessionDto } from "./dto/create-session.dto";
import { ListSessionSuggestionsDto } from "./dto/list-session-suggestions.dto";
import { ListSessionsDto } from "./dto/list-sessions.dto";
import { WITH_TAGS_AND_SERIES } from "./types/session-row";
import { toSessionDto } from "./session-mapper";
import { createEventData } from "./session-events";
import { mapSessionPrismaError } from "./prisma-error";
import { SeriesService } from "./series.service";

/**
 * Shown when a `TASK` (or series) has no feasible slot anywhere between now
 * and its deadline — {@link SessionCrudService.create}'s pre-flight check
 * rejects the whole create with this message before inserting anything, so
 * nothing accumulates half-placed. A `"\n"` splits a short title from its
 * description — the mobile client's `splitToastMessage` renders the two
 * lines separately instead of one long wrapped, bold line.
 */
export const NO_FEASIBLE_SLOT_MESSAGE =
  "No open slot before the deadline\nLoosen the deadline or reduce the number of sessions, then try again.";

/**
 * Plain session CRUD: `create` (dispatches by type — single `TASK`,
 * recurring-fixed, one-off-fixed; a `sessionCount > 1` `TASK` goes to
 * {@link SeriesService}), `list` (fans recurring reps into virtual occurrences),
 * `suggestions`, `findById`, `remove`. A single `TASK` create is placed via
 * {@link TaskPlacementService}; nothing else on the calendar moves. A `TASK`
 * (or series) with no feasible slot before its deadline is rejected by a
 * pre-flight check ({@link NO_FEASIBLE_SLOT_MESSAGE}) before anything is
 * inserted.
 */
@Injectable()
export class SessionCrudService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tagsService: TagsService,
    private readonly taskPlacement: TaskPlacementService,
    private readonly series: SeriesService,
  ) {}

  async create(
    dto: CreateSessionDto,
    user: User,
  ): Promise<CreateSessionResponse> {
    const cleanTags = (dto.tags ?? []).map((t) => t.trim()).filter(Boolean);
    const now = new Date();

    if (dto.type === "TASK") {
      const deadline = new Date(dto.deadline as string);
      const sessionCount = Math.max(1, Math.trunc(dto.sessionCount ?? 1));

      // Pre-flight feasibility — BEFORE any row is inserted, so an
      // infeasible request never leaves an unplaced task/series behind (no
      // rollback needed; see NO_FEASIBLE_SLOT_MESSAGE).
      const feasible =
        sessionCount > 1
          ? await this.taskPlacement.canPlaceSeries({
              user,
              durationMinutes: dto.durationMinutes,
              sessionCount,
              deadline,
              now,
            })
          : await this.taskPlacement.canPlaceTask({
              user,
              durationMinutes: dto.durationMinutes,
              deadline,
              now,
            });
      if (!feasible) throw new BadRequestException(NO_FEASIBLE_SLOT_MESSAGE);

      if (sessionCount > 1) {
        return this.series.createTaskSeries(
          dto,
          user,
          cleanTags,
          deadline,
          sessionCount,
          now,
        );
      }
      return this.createSingleTask(dto, user, cleanTags, deadline, now);
    }

    if (dto.rrule) {
      return this.createFixedRecurring(dto, user, cleanTags);
    }
    return this.createFixedOneOff(dto, user, cleanTags);
  }

  /** A flexible, deadline-driven `TASK` — inserted, then engine-placed. */
  private async createSingleTask(
    dto: CreateSessionDto,
    user: User,
    cleanTags: string[],
    deadline: Date,
    now: Date,
  ): Promise<CreateSessionResponse> {
    const created = await this.prisma.$transaction(async (tx) => {
      const tagIds = await this.tagsService.resolveTagIds(
        tx,
        user.id,
        cleanTags,
      );
      const s = await tx.session.create({
        data: {
          type: "TASK",
          source: "USER",
          title: dto.title,
          note: dto.note ?? null,
          durationMinutes: dto.durationMinutes,
          deadline,
          tags: { connect: tagIds.map((id) => ({ id })) },
          userId: user.id,
        },
        include: WITH_TAGS_AND_SERIES,
      });
      await tx.sessionEvent.create({ data: createEventData(s, user.id) });
      return s;
    });

    // heuristic → 50/50 A/B → optional LinUCB override + SlotProposal.
    const { scheduledStartTime } = await this.taskPlacement.placeOnCreate({
      user,
      task: {
        id: created.id,
        durationMinutes: created.durationMinutes,
        deadline,
      },
      now,
    });
    return toSessionDto({ ...created, scheduledStartTime });
  }

  /**
   * A recurring fixed session (`DND` / `ASSIGNMENT` / `EXAM` / `LECTURE` +
   * `rrule`): one `SessionSeries` holds the pattern, one representative row
   * anchors the first occurrence, `list()` fans it out. User-pinned — no
   * placement.
   */
  private async createFixedRecurring(
    dto: CreateSessionDto,
    user: User,
    cleanTags: string[],
  ): Promise<CreateSessionResponse> {
    const anchor = new Date(dto.scheduledStartTime as string);
    const repStart = firstOccurrence(
      dto.rrule as string,
      anchor,
      user.timezone,
    );

    const created = await this.prisma.$transaction(async (tx) => {
      const tagIds = await this.tagsService.resolveTagIds(
        tx,
        user.id,
        cleanTags,
      );
      const series = await tx.sessionSeries.create({
        data: {
          type: dto.type,
          rrule: dto.rrule as string,
          deadline: null,
          userId: user.id,
        },
      });
      const s = await tx.session.create({
        data: {
          type: dto.type,
          source: "USER",
          title: dto.title,
          note: dto.note ?? null,
          durationMinutes: dto.durationMinutes,
          deadline: null,
          scheduledStartTime: repStart,
          seriesId: series.id,
          tags: { connect: tagIds.map((id) => ({ id })) },
          userId: user.id,
        },
        include: WITH_TAGS_AND_SERIES,
      });
      await tx.sessionEvent.create({ data: createEventData(s, user.id) });
      return s;
    });

    return toSessionDto(created);
  }

  /** A one-off fixed session (`ASSIGNMENT` / `EXAM` / `LECTURE` / non-recurring
   * `DND`). User-pinned — no placement. */
  private async createFixedOneOff(
    dto: CreateSessionDto,
    user: User,
    cleanTags: string[],
  ): Promise<CreateSessionResponse> {
    const start = new Date(dto.scheduledStartTime as string);
    const created = await this.prisma.$transaction(async (tx) => {
      const tagIds = await this.tagsService.resolveTagIds(
        tx,
        user.id,
        cleanTags,
      );
      const s = await tx.session.create({
        data: {
          type: dto.type,
          source: "USER",
          title: dto.title,
          note: dto.note ?? null,
          durationMinutes: dto.durationMinutes,
          deadline: null,
          scheduledStartTime: start,
          tags: { connect: tagIds.map((id) => ({ id })) },
          userId: user.id,
        },
        include: WITH_TAGS_AND_SERIES,
      });
      await tx.sessionEvent.create({ data: createEventData(s, user.id) });
      return s;
    });

    return toSessionDto(created);
  }

  async list(dto: ListSessionsDto, user: User): Promise<SessionsListResponse> {
    const tz = user.timezone;
    const { startStr: displayStartStr, endStr: displayEndStr } =
      displayDayRange(dto.view, dto.date);
    const displayStart = minutesToUtc(displayStartStr, 0, tz);
    const displayEnd = minutesToUtc(displayEndStr, 1439, tz);

    const rows = await this.prisma.session.findMany({
      where: {
        userId: user.id,
        OR: [
          { scheduledStartTime: null },
          // A day back so a plain session that started the previous evening
          // and runs past midnight into this window is still fetched —
          // filtered to actual overlap below (mirrors day-load.ts's
          // occupancy scan for the same class of bug on the placement side).
          {
            scheduledStartTime: {
              gte: new Date(displayStart.getTime() - DAY_MS),
              lte: displayEnd,
            },
          },
          // Series representatives: first-occurrence instant may be outside the
          // window; expanded below.
          { seriesId: { not: null } },
        ],
      },
      include: WITH_TAGS_AND_SERIES,
    });

    const sessions: SharedSession[] = [];
    for (const row of rows) {
      if (row.seriesId && row.series?.rrule && row.scheduledStartTime) {
        const base = toSessionDto(row);
        for (const occ of expandRrule(
          row.series.rrule,
          row.scheduledStartTime,
          // Same day-back widening as above, so an occurrence that started
          // the previous day and crosses into this window isn't dropped.
          new Date(displayStart.getTime() - DAY_MS),
          displayEnd,
          tz,
          row.series.exdates,
        )) {
          const occEnd = occ.getTime() + row.durationMinutes * 60_000;
          if (occEnd <= displayStart.getTime()) continue; // ended before this day
          sessions.push({
            ...base,
            id: occurrenceId(row.seriesId, occ),
            scheduledStartTime: occ.toISOString(),
          });
        }
      } else {
        // A plain row's scheduledStartTime may sit in the previous day (the
        // widened query above) but its interval never reach into this
        // window — only keep it if it actually overlaps. Unscheduled rows
        // (scheduledStartTime null) always pass through untouched.
        if (
          row.scheduledStartTime &&
          row.scheduledStartTime.getTime() + row.durationMinutes * 60_000 <=
            displayStart.getTime()
        ) {
          continue;
        }
        sessions.push(toSessionDto(row));
      }
    }

    return { sessions };
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
      include: WITH_TAGS_AND_SERIES,
      take: limit,
    });

    return { suggestions: rows.map((r) => toSessionDto(r)) };
  }

  async findById(id: string, user: User): Promise<SessionDetailResponse> {
    // A recurring occurrence ref resolves to its series' representative row,
    // re-stamped with the occurrence's own id + start.
    const occ = parseOccurrenceId(id);
    if (occ) {
      const rep = await this.prisma.session.findFirst({
        where: { seriesId: occ.seriesId, userId: user.id },
        include: WITH_TAGS_AND_SERIES,
      });
      if (!rep)
        throw new NotFoundException(`Cannot find session with id ${id}`);
      return { ...toSessionDto(rep), id, scheduledStartTime: occ.startISO };
    }

    const session = await this.prisma.session.findUnique({
      where: { id, userId: user.id },
      include: WITH_TAGS_AND_SERIES,
    });
    if (!session)
      throw new NotFoundException(`Cannot find session with id ${id}`);

    return toSessionDto(session);
  }

  async remove(id: string, user: User): Promise<RemoveSessionResponse> {
    try {
      // A recurring occurrence ref → add the instant to the series' exdates
      // ("delete this one"); the row and other occurrences stay put.
      const occ = parseOccurrenceId(id);
      if (occ)
        return await this.series.excludeOccurrence(
          occ.seriesId,
          occ.startISO,
          user,
        );

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
      mapSessionPrismaError(error, id, "remove");
    }
  }
}
