import { Injectable, NotFoundException } from "@nestjs/common";
import type {
  CreateSessionResponse,
  RemoveSessionResponse,
  RemoveSessionSeriesResponse,
  Session as SharedSession,
} from "@zenflow/shared";
import { type User } from "../../generated/prisma";
import { PrismaService } from "../prisma/prisma.service";
import { TagsService } from "../tags/tags.service";
import { TaskPlacementService } from "../scheduler/io/task-placement.service";
import { occurrenceId, rruleWithUntil } from "../scheduler/core/recurrence";
import { CreateSessionDto } from "./dto/create-session.dto";
import { SessionRow, WITH_TAGS_AND_SERIES } from "./types/session-row";
import { toSessionDto } from "./session-mapper";
import { createEventData } from "./session-events";

/**
 * Every `SessionSeries` lifecycle op — the `sessionCount > 1` `TASK` batch, its
 * deadline redistribution, and the four ways to delete part or all of a series
 * (issue #32). `SessionsService` delegates the matching endpoints here; recurring
 * fixed-type series are created in `SessionCrudService` (they need no placement).
 */
@Injectable()
export class SeriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tagsService: TagsService,
    private readonly taskPlacement: TaskPlacementService,
  ) {}

  /**
   * Create a `TASK` series: one `SessionSeries` (`type: TASK`, shared `deadline`,
   * no `rrule`) plus `count` linked `Session` rows, then hand the batch to
   * {@link TaskPlacementService.placeSeriesOnCreate} — each member is spread
   * across `now … deadline` and placed through the same per-member 50/50
   * heuristic-or-LinUCB pick as a single task, ≤3 per calendar day, no member
   * overlapping another and no existing session moved.
   */
  async createTaskSeries(
    dto: CreateSessionDto,
    user: User,
    cleanTags: string[],
    deadline: Date,
    count: number,
    now: Date,
  ): Promise<CreateSessionResponse> {
    const rows = await this.prisma.$transaction(async (tx) => {
      const tagIds = await this.tagsService.resolveTagIds(
        tx,
        user.id,
        cleanTags,
      );
      const series = await tx.sessionSeries.create({
        data: { type: "TASK", rrule: null, deadline, userId: user.id },
      });

      const created: SessionRow[] = [];
      for (let i = 0; i < count; i++) {
        const s = await tx.session.create({
          data: {
            type: "TASK",
            source: "USER",
            title: dto.title,
            note: dto.note ?? null,
            durationMinutes: dto.durationMinutes,
            deadline,
            seriesId: series.id,
            sessionIndex: i + 1,
            sessionTotal: count,
            tags: { connect: tagIds.map((id) => ({ id })) },
            userId: user.id,
          },
          include: WITH_TAGS_AND_SERIES,
        });
        await tx.sessionEvent.create({
          data: createEventData(s, user.id, series.id),
        });
        created.push(s);
      }
      return created;
    });

    const placements = await this.taskPlacement.placeSeriesOnCreate({
      user,
      seriesId: rows[0]?.seriesId as string,
      members: rows.map((r) => ({
        id: r.id,
        durationMinutes: r.durationMinutes,
      })),
      deadline,
      now,
    });

    const startById = new Map(
      placements.map((p) => [p.id, p.scheduledStartTime]),
    );
    const sessions = rows.map((r) =>
      toSessionDto({ ...r, scheduledStartTime: startById.get(r.id) ?? null }),
    );
    return { ...sessions[0], sessions };
  }

  /**
   * A `TASK` series' deadline moved: hand the still-upcoming sittings to
   * {@link TaskPlacementService.redistributeSeries}, which pushes the new
   * `deadline` onto the series row + every member and re-runs the per-member
   * bounded 50/50 placement over the new window. Past sittings keep their slot.
   * No non-series session is moved. Returns every member (`sessionIndex` order).
   */
  async redistribute(
    seriesId: string,
    user: User,
    newDeadline: Date,
    now: Date,
  ): Promise<SharedSession[]> {
    const members = await this.prisma.session.findMany({
      where: { seriesId, userId: user.id },
      include: WITH_TAGS_AND_SERIES,
      orderBy: [{ sessionIndex: "asc" }, { createdAt: "asc" }],
    });
    if (members.length === 0) return [];

    const placed = await this.taskPlacement.redistributeSeries({
      user,
      seriesId,
      members: members.map((m) => ({
        id: m.id,
        durationMinutes: m.durationMinutes,
        scheduledStartTime: m.scheduledStartTime,
      })),
      newDeadline,
      now,
    });
    const startById = new Map(placed.map((p) => [p.id, p.scheduledStartTime]));

    return members.map((m) =>
      toSessionDto({
        ...m,
        deadline: newDeadline,
        scheduledStartTime: startById.get(m.id) ?? null,
      }),
    );
  }

  /**
   * "Delete just this occurrence" of a recurring series — append the instant to
   * `SessionSeries.exdates` so `expandRrule` skips it. Idempotent. The
   * representative row is never touched.
   */
  async excludeOccurrence(
    seriesId: string,
    startISO: string,
    user: User,
  ): Promise<RemoveSessionResponse> {
    const canonical = new Date(startISO).toISOString();
    const series = await this.prisma.sessionSeries.findFirst({
      where: { id: seriesId, userId: user.id },
      select: { id: true, rrule: true, exdates: true },
    });
    if (!series || !series.rrule)
      throw new NotFoundException(`Cannot find recurring series ${seriesId}`);

    if (
      !series.exdates.some(
        (e) => new Date(e).getTime() === new Date(canonical).getTime(),
      )
    ) {
      await this.prisma.sessionSeries.update({
        where: { id: seriesId },
        data: { exdates: { push: canonical } },
      });
    }
    return { id: occurrenceId(seriesId, new Date(canonical)) };
  }

  /**
   * "Delete this occurrence and every one after it" — pull the series' `rrule`
   * `UNTIL` back to just before `fromStartISO`. If the cutoff lands on or before
   * the first occurrence, the whole series is deleted instead.
   */
  async truncateFrom(
    seriesId: string,
    fromStartISO: string,
    user: User,
  ): Promise<RemoveSessionSeriesResponse> {
    const from = new Date(fromStartISO);
    if (Number.isNaN(from.getTime()))
      throw new NotFoundException(`Invalid occurrence start "${fromStartISO}"`);

    return this.prisma.$transaction(async (tx) => {
      const series = await tx.sessionSeries.findFirst({
        where: { id: seriesId, userId: user.id },
        include: {
          sessions: { select: { id: true, scheduledStartTime: true } },
        },
      });
      if (!series || !series.rrule)
        throw new NotFoundException(`Cannot find recurring series ${seriesId}`);

      const rep = series.sessions[0];
      const until = new Date(from.getTime() - 1000); // 1s before the cutoff occurrence

      if (rep?.scheduledStartTime && until < rep.scheduledStartTime) {
        const removedSessionIds = series.sessions.map((s) => s.id);
        await tx.sessionSeries.delete({ where: { id: seriesId } });
        return { seriesId, removedSessionIds, seriesGone: true };
      }

      await tx.sessionSeries.update({
        where: { id: seriesId },
        data: {
          rrule: rruleWithUntil(series.rrule, until),
          exdates: series.exdates.filter(
            (e) => new Date(e).getTime() < until.getTime(),
          ),
        },
      });
      return { seriesId, removedSessionIds: [], seriesGone: false };
    });
  }

  /**
   * Delete a whole series in one action (issue #32) — every session (cascade),
   * then the `SessionSeries` row. Also the "undo the batch" action.
   */
  async removeSeries(
    seriesId: string,
    user: User,
  ): Promise<RemoveSessionSeriesResponse> {
    return this.prisma.$transaction(async (tx) => {
      const series = await tx.sessionSeries.findFirst({
        where: { id: seriesId, userId: user.id },
        include: { sessions: { select: { id: true } } },
      });
      if (!series)
        throw new NotFoundException(`Cannot find series with id ${seriesId}`);

      const removedSessionIds = series.sessions.map((s) => s.id);
      await tx.sessionSeries.delete({ where: { id: seriesId } });
      return { seriesId, removedSessionIds, seriesGone: true };
    });
  }

  /**
   * Delete one session and every later one in the same series (`sessionIndex`
   * order, then `createdAt`), keeping the earlier ones and the series row (issue
   * #32). If nothing remains, the series row goes too.
   */
  async removeFrom(
    seriesId: string,
    sessionId: string,
    user: User,
  ): Promise<RemoveSessionSeriesResponse> {
    return this.prisma.$transaction(async (tx) => {
      const series = await tx.sessionSeries.findFirst({
        where: { id: seriesId, userId: user.id },
        include: {
          sessions: {
            select: { id: true, sessionIndex: true, createdAt: true },
            orderBy: [{ sessionIndex: "asc" }, { createdAt: "asc" }],
          },
        },
      });
      if (!series)
        throw new NotFoundException(`Cannot find series with id ${seriesId}`);

      const anchor = series.sessions.find((s) => s.id === sessionId);
      if (!anchor)
        throw new NotFoundException(
          `Session ${sessionId} is not part of series ${seriesId}`,
        );

      const doomed =
        anchor.sessionIndex != null
          ? series.sessions.filter(
              (s) =>
                s.sessionIndex != null &&
                s.sessionIndex >= (anchor.sessionIndex as number),
            )
          : series.sessions.filter(
              (s) => s.createdAt.getTime() >= anchor.createdAt.getTime(),
            );
      const removedSessionIds = doomed.map((s) => s.id);

      await tx.session.deleteMany({
        where: { id: { in: removedSessionIds }, userId: user.id },
      });

      const seriesGone = removedSessionIds.length >= series.sessions.length;
      if (seriesGone) {
        await tx.sessionSeries.delete({ where: { id: seriesId } });
      }
      return { seriesId, removedSessionIds, seriesGone };
    });
  }
}
