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
import { wouldConflict } from "../scheduler/io/conflict-check";
import {
  expandRrule,
  firstOccurrence,
  occurrenceId,
  rruleWithUntil,
} from "../scheduler/core/recurrence";
import { MAX_SCAN_DAYS } from "../scheduler/constants";
import { DAY_MS, localDateStr } from "../scheduler/core/slot";
import { minutesToUtc } from "../common/utils";
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
   * A `TASK` series' "this and later sittings" / "all sittings" reschedule
   * (issue: drag/resize confirmation scopes). Every affected sibling KEEPS
   * its own calendar date — only its time-of-day (and, if resized, its
   * duration) changes, so no sitting's date ever shifts. Reuses `removeFrom`'s
   * sibling-selection shape: `following` = every sitting whose `sessionIndex`
   * is ≥ the anchor's (falling back to `createdAt` order when `sessionIndex`
   * is unset), `scopeAll` = every sitting in the series.
   *
   * With `skipConflicting`, each candidate landing is checked via
   * {@link wouldConflict} (excluding every id in this series, since a
   * materialized TASK series never lands its own sittings on top of each
   * other) — a sitting whose new landing would overlap something else is left
   * untouched and its id recorded in `skippedSessionIds`.
   *
   * Returns every member (`sessionIndex` order, same shape {@link redistribute}
   * returns) — untouched/skipped members come back with their prior state.
   */
  async updateSiblingTimeOfDay(
    seriesId: string,
    anchorSessionId: string,
    change: { timeOfDayMinutes: number; durationMinutes?: number },
    scopeAll: boolean,
    skipConflicting: boolean,
    user: User,
  ): Promise<{ sessions: SharedSession[]; skippedSessionIds: string[] }> {
    return this.prisma.$transaction(async (tx) => {
      const members = await tx.session.findMany({
        where: { seriesId, userId: user.id },
        include: WITH_TAGS_AND_SERIES,
        orderBy: [{ sessionIndex: "asc" }, { createdAt: "asc" }],
      });
      if (members.length === 0)
        throw new NotFoundException(`Cannot find series with id ${seriesId}`);

      const anchor = members.find((m) => m.id === anchorSessionId);
      if (!anchor)
        throw new NotFoundException(
          `Session ${anchorSessionId} is not part of series ${seriesId}`,
        );

      const targets = scopeAll
        ? members
        : anchor.sessionIndex != null
          ? members.filter(
              (m) =>
                m.sessionIndex != null &&
                m.sessionIndex >= (anchor.sessionIndex as number),
            )
          : members.filter(
              (m) => m.createdAt.getTime() >= anchor.createdAt.getTime(),
            );

      const allMemberIds = members.map((m) => m.id);
      const skippedSessionIds: string[] = [];
      const updatedById = new Map<string, SessionRow>();

      for (const sibling of targets) {
        // No date to keep for a not-yet-placed sitting — nothing to re-anchor.
        if (!sibling.scheduledStartTime) continue;

        const dayStr = localDateStr(sibling.scheduledStartTime, user.timezone);
        const newStart = minutesToUtc(
          dayStr,
          change.timeOfDayMinutes,
          user.timezone,
        );
        const newDuration = change.durationMinutes ?? sibling.durationMinutes;

        if (skipConflicting) {
          const conflict = await wouldConflict(tx, {
            userId: user.id,
            timezone: user.timezone,
            start: newStart,
            durationMinutes: newDuration,
            excludeSessionIds: allMemberIds,
            excludeSeriesId: seriesId,
          });
          if (conflict) {
            skippedSessionIds.push(sibling.id);
            continue;
          }
        }

        const row = await tx.session.update({
          where: { id: sibling.id },
          data: { scheduledStartTime: newStart, durationMinutes: newDuration },
          include: WITH_TAGS_AND_SERIES,
        });
        updatedById.set(sibling.id, row);
      }

      const sessions = members.map((m) =>
        toSessionDto(updatedById.get(m.id) ?? m),
      );
      return { sessions, skippedSessionIds };
    });
  }

  /**
   * A recurring fixed series' "this and following" reschedule — no
   * per-occurrence detach primitive exists, so this is the finest granularity
   * a recurring drag/resize can target. Reuses {@link truncateFrom} to cut the
   * OLD series off just before `fromOccurrenceStartISO` (or delete it outright
   * if the cutoff lands on/before its first occurrence), then spins up a brand
   * new `SessionSeries` + representative `Session` — same type/title/note/tags
   * and the SAME rrule pattern — anchored at the new date/time going forward.
   *
   * With `skipConflicting`, every occurrence of the NEW series up to
   * {@link MAX_SCAN_DAYS} out is expanded ({@link expandRrule}) and checked via
   * {@link wouldConflict} (excluding the new series' own row); a conflicting
   * occurrence is pushed onto the new series' `exdates` via
   * {@link excludeOccurrence} — same primitive "delete just this occurrence"
   * uses — rather than moved on top of something else.
   */
  async updateRecurringFollowing(
    seriesId: string,
    fromOccurrenceStartISO: string,
    change: { scheduledStartTime: string; durationMinutes: number },
    skipConflicting: boolean,
    user: User,
  ): Promise<{ session: SharedSession; skippedSessionIds: string[] }> {
    const oldSeries = await this.prisma.sessionSeries.findFirst({
      where: { id: seriesId, userId: user.id },
      include: {
        sessions: {
          orderBy: { createdAt: "asc" },
          take: 1,
          include: WITH_TAGS_AND_SERIES,
        },
      },
    });
    const rep = oldSeries?.sessions[0];
    if (!oldSeries || !oldSeries.rrule || !rep)
      throw new NotFoundException(`Cannot find recurring series ${seriesId}`);
    const rrule = oldSeries.rrule;

    await this.truncateFrom(seriesId, fromOccurrenceStartISO, user);

    const newStart = new Date(change.scheduledStartTime);
    const repStart = firstOccurrence(rrule, newStart, user.timezone);

    const created = await this.prisma.$transaction(async (tx) => {
      const series = await tx.sessionSeries.create({
        data: { type: rep.type, rrule, deadline: null, userId: user.id },
      });
      const s = await tx.session.create({
        data: {
          type: rep.type,
          source: rep.source,
          title: rep.title,
          note: rep.note,
          durationMinutes: change.durationMinutes,
          deadline: null,
          scheduledStartTime: repStart,
          seriesId: series.id,
          tags: { connect: rep.tags.map((t) => ({ id: t.id })) },
          userId: user.id,
        },
        include: WITH_TAGS_AND_SERIES,
      });
      await tx.sessionEvent.create({
        data: createEventData(s, user.id, series.id),
      });
      return s;
    });

    const skippedSessionIds: string[] = [];
    if (skipConflicting) {
      const scanEnd = new Date(repStart.getTime() + MAX_SCAN_DAYS * DAY_MS);
      const occStarts = expandRrule(
        rrule,
        repStart,
        repStart,
        scanEnd,
        user.timezone,
      );
      for (const occStart of occStarts) {
        const conflict = await wouldConflict(this.prisma, {
          userId: user.id,
          timezone: user.timezone,
          start: occStart,
          durationMinutes: change.durationMinutes,
          excludeSessionIds: [created.id],
          excludeSeriesId: created.seriesId as string,
        });
        if (conflict) {
          await this.excludeOccurrence(
            created.seriesId as string,
            occStart.toISOString(),
            user,
          );
          skippedSessionIds.push(
            occurrenceId(created.seriesId as string, occStart),
          );
        }
      }
    }

    return { session: toSessionDto(created), skippedSessionIds };
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
