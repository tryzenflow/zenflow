import { Injectable, NotFoundException } from "@nestjs/common";
import type { InfeasiblePolicy, UpdateSessionResponse } from "@zenflow/shared";
import { Prisma, type User } from "../../generated/prisma";
import { PrismaService } from "../prisma/prisma.service";
import { TagsService } from "../tags/tags.service";
import { TaskPlacementService } from "../scheduler/io/task-placement.service";
import { SchedulingFeedbackService } from "../scheduler/io/scheduling-feedback.service";
import { wouldConflict } from "../scheduler/io/conflict-check";
import {
  expandRrule,
  firstOccurrence,
  occurrenceId,
  parseOccurrenceId,
  reanchorTimeOfDay,
} from "../scheduler/core/recurrence";
import { MAX_SCAN_DAYS } from "../scheduler/constants";
import { DAY_MS } from "../scheduler/core/slot";
import { utcToMinutes } from "../common/utils";
import { UpdateSessionDto } from "./dto/update-session.dto";
import { SessionRow, WITH_TAGS_AND_SERIES } from "./types/session-row";
import {
  NO_SLOT_PROPOSAL,
  slotProposalFieldsOf,
  toUpdateSessionResponse,
} from "./session-mapper";
import { moveEventData } from "./session-events";
import { mapSessionPrismaError } from "./prisma-error";
import { SeriesService } from "./series.service";

/** The parsed shape of a recurring-occurrence ref ("<seriesId>::<startISO>"). */
type OccurrenceRef = NonNullable<ReturnType<typeof parseOccurrenceId>>;

/** `dto` carries an actual reschedule/resize — the only case `scope` matters. */
function isRescheduleChange(dto: UpdateSessionDto): boolean {
  return (
    dto.scheduledStartTime !== undefined || dto.durationMinutes !== undefined
  );
}

/** What one first user move (drag/resize) of a session needs to trigger the
 * delayed LinUCB reward (when applicable) and the unconditional
 * preference-matrix reinforcement (Item 3B3), surfaced out of the
 * field-diff transaction. `oldStartMs` is the start that was actually placed
 * and then rejected; `newStartMs` is the user-chosen destination. */
interface FirstMove {
  eventId: bigint;
  dragDistanceMinutes: number;
  oldStartMs: number;
  newStartMs: number;
}

/** Everything the rest of `update()` needs out of the plain-field-diff
 * transaction (recurrence lifecycle included). */
interface FieldDiffResult {
  updated: SessionRow;
  firstMove: FirstMove | null;
  newDeadline: Date | null;
}

/**
 * `PATCH /sessions/:id` — a plain field diff, plus (for fixed types) the
 * whole-series recurrence lifecycle, the `MOVE` telemetry + first-move LinUCB
 * reward for a user drag/resize of a scheduled `TASK`, and — on a deadline
 * change — a single re-placement (standalone task) or series redistribution.
 * Never auto-searches otherwise; no other session is ever moved.
 *
 * Reads top-to-bottom as the sequence of things a PATCH can mean: a recurring
 * "this and following" split, a recurring occurrence re-anchor, a materialized
 * series' sibling reschedule, the plain field diff (+ recurrence lifecycle +
 * MOVE telemetry), session-count resize/promote, deadline redistribution,
 * then conflict pruning — each step short-circuits with its own response when
 * it applies; the rest fall through to the plain-diff response at the end.
 */
@Injectable()
export class SessionUpdateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tagsService: TagsService,
    private readonly taskPlacement: TaskPlacementService,
    private readonly schedulingFeedback: SchedulingFeedbackService,
    private readonly series: SeriesService,
  ) {}

  async update(
    id: string,
    dto: UpdateSessionDto,
    user: User,
  ): Promise<UpdateSessionResponse> {
    try {
      const now = new Date();
      const occ = parseOccurrenceId(id);

      const followingSplit = await this.handleFollowingRecurringSplit(
        id,
        occ,
        dto,
        user,
      );
      if (followingSplit) return followingSplit;

      id = await this.resolveOccurrenceTarget(id, occ, dto, user);

      const siblingScope = occ
        ? null
        : await this.handleMaterializedSiblingScope(id, dto, user);
      if (siblingScope) return siblingScope;

      if (!occ) await this.guardDeadlineEdit(id, dto, user, now);

      const { updated, firstMove, newDeadline } =
        await this.runFieldDiffTransaction(id, dto, user, now);

      if (firstMove) {
        await this.schedulingFeedback.onFirstMove(
          user.id,
          id,
          firstMove.eventId,
          firstMove.dragDistanceMinutes,
        );
        await this.schedulingFeedback.reinforcePreferenceMove(
          user.id,
          firstMove.oldStartMs,
          firstMove.newStartMs,
          user.timezone,
          firstMove.dragDistanceMinutes,
        );
      }

      const resize = await this.handleSessionCountResize(
        dto,
        updated,
        user,
        now,
      );
      if (resize) return resize;

      const redistribution = await this.handleDeadlineRedistribution(
        newDeadline,
        updated,
        user,
        now,
        dto.infeasiblePolicy,
      );
      if (redistribution) return redistribution;

      const skippedSessionIds = await this.pruneConflictingOccurrences(
        occ,
        dto,
        updated,
        now,
        user,
      );

      return { ...toUpdateSessionResponse(updated), skippedSessionIds };
    } catch (error) {
      mapSessionPrismaError(error, id, "update");
    }
  }

  /**
   * Pre-flight for a TASK deadline edit, BEFORE the field-diff transaction
   * writes anything (issue #62 E): rejects `now + duration > deadline` (400);
   * for a standalone TASK also runs the same slot / repack / accept-policy
   * check a create does (409 `SCHEDULE_INFEASIBLE`). A series member only gets
   * the arithmetic guard — its siblings' own slots make a dry-run ambiguous.
   */
  private async guardDeadlineEdit(
    id: string,
    dto: UpdateSessionDto,
    user: User,
    now: Date,
  ): Promise<void> {
    if (dto.deadline === undefined) return;
    const existing = await this.prisma.session.findFirst({
      where: { id, userId: user.id, deleted: false },
      select: {
        type: true,
        durationMinutes: true,
        seriesId: true,
        deadline: true,
      },
    });
    if (!existing || existing.type !== "TASK") return;
    const deadline = new Date(dto.deadline);
    if (existing.deadline?.getTime() === deadline.getTime()) return;
    const durationMinutes = dto.durationMinutes ?? existing.durationMinutes;

    await this.taskPlacement.preflightTask({
      user,
      taskId: id,
      durationMinutes,
      deadline,
      now,
      policy: dto.infeasiblePolicy,
      arithmeticOnly: existing.seriesId !== null,
    });
  }

  /**
   * A recurring occurrence ref ("<seriesId>::<startISO>") with `scope:
   * "following"` and an actual reschedule — a genuine "this and every
   * occurrence after it" split, which has no representative-row-reanchor
   * equivalent and needs its own series. `null` when this PATCH isn't that.
   */
  private async handleFollowingRecurringSplit(
    id: string,
    occ: OccurrenceRef | null,
    dto: UpdateSessionDto,
    user: User,
  ): Promise<UpdateSessionResponse | null> {
    if (!(occ && dto.scope === "following" && isRescheduleChange(dto))) {
      return null;
    }
    const rep = await this.prisma.session.findFirst({
      where: { seriesId: occ.seriesId, userId: user.id, deleted: false },
      select: { scheduledStartTime: true, durationMinutes: true },
    });
    if (!rep || !rep.scheduledStartTime)
      throw new NotFoundException(`Cannot find session with id ${id}`);

    const { session, skippedSessionIds } =
      await this.series.updateRecurringFollowing(
        occ.seriesId,
        occ.startISO,
        {
          scheduledStartTime:
            dto.scheduledStartTime ?? rep.scheduledStartTime.toISOString(),
          durationMinutes: dto.durationMinutes ?? rep.durationMinutes,
        },
        dto.skipConflicting ?? false,
        user,
      );
    return {
      ...session,
      ...NO_SLOT_PROPOSAL,
      skippedSessionIds: skippedSessionIds.length
        ? skippedSessionIds
        : undefined,
    };
  }

  /**
   * A recurring occurrence ref (not otherwise handled above) edits its series
   * through the representative row: metadata applies series-wide; a
   * `scheduledStartTime` change shifts only the *time of day* (the
   * first-occurrence date is kept so the rrule anchor can't drop earlier
   * occurrences — mutates `dto.scheduledStartTime` in place). Returns the id
   * to operate on for the rest of `update()` — the representative row's real
   * id, or `id` unchanged when this PATCH isn't an occurrence ref.
   */
  private async resolveOccurrenceTarget(
    id: string,
    occ: OccurrenceRef | null,
    dto: UpdateSessionDto,
    user: User,
  ): Promise<string> {
    if (!occ) return id;

    const rep = await this.prisma.session.findFirst({
      where: { seriesId: occ.seriesId, userId: user.id, deleted: false },
      select: { id: true, scheduledStartTime: true },
    });
    if (!rep) throw new NotFoundException(`Cannot find session with id ${id}`);

    if (dto.scheduledStartTime && rep.scheduledStartTime) {
      dto.scheduledStartTime = reanchorTimeOfDay(
        rep.scheduledStartTime,
        new Date(dto.scheduledStartTime),
        user.timezone,
      ).toISOString();
    }
    return rep.id;
  }

  /**
   * A real row belonging to a materialized `TASK` series ("this and later
   * sittings" / "all sittings") reschedules every affected sibling's
   * time-of-day (never its date) instead of just this one row. `null` when
   * this PATCH isn't that (not scoped, not a reschedule, or not a `TASK`
   * series member).
   */
  private async handleMaterializedSiblingScope(
    id: string,
    dto: UpdateSessionDto,
    user: User,
  ): Promise<UpdateSessionResponse | null> {
    if (
      !(
        (dto.scope === "following" || dto.scope === "series") &&
        isRescheduleChange(dto)
      )
    ) {
      return null;
    }

    const existingForScope = await this.prisma.session.findFirst({
      where: { id, userId: user.id, deleted: false },
      select: {
        seriesId: true,
        scheduledStartTime: true,
        series: { select: { type: true } },
      },
    });
    if (
      !existingForScope?.seriesId ||
      existingForScope.series?.type !== "TASK"
    ) {
      return null;
    }

    const anchorStart = dto.scheduledStartTime
      ? new Date(dto.scheduledStartTime)
      : existingForScope.scheduledStartTime;
    if (!anchorStart) return null;

    const { sessions, skippedSessionIds } =
      await this.series.updateSiblingTimeOfDay(
        existingForScope.seriesId,
        id,
        {
          timeOfDayMinutes: utcToMinutes(anchorStart, user.timezone),
          durationMinutes: dto.durationMinutes,
        },
        dto.scope === "series",
        dto.skipConflicting ?? false,
        user,
      );
    const rep = sessions.find((s) => s.id === id) ?? sessions[0];
    return {
      ...rep,
      ...NO_SLOT_PROPOSAL,
      sessions,
      skippedSessionIds: skippedSessionIds.length
        ? skippedSessionIds
        : undefined,
    };
  }

  /** The plain field diff + (for fixed types) the whole-series recurrence
   * lifecycle + `MOVE` telemetry, all in one transaction. */
  private runFieldDiffTransaction(
    id: string,
    dto: UpdateSessionDto,
    user: User,
    now: Date,
  ): Promise<FieldDiffResult> {
    return this.prisma.$transaction(async (tx): Promise<FieldDiffResult> => {
      const existing = await tx.session.findFirst({
        where: { id, userId: user.id, deleted: false },
        include: WITH_TAGS_AND_SERIES,
      });
      if (!existing)
        throw new NotFoundException(`Cannot find session with id ${id}`);

      const data: Prisma.SessionUpdateInput = {};
      let newDeadline: Date | null = null;
      if (dto.title !== undefined) data.title = dto.title;
      if (dto.note !== undefined) data.note = dto.note;
      if (dto.location !== undefined) data.location = dto.location;

      if (dto.durationMinutes !== undefined)
        data.durationMinutes = dto.durationMinutes;

      if (dto.deadline !== undefined) {
        const candidate = new Date(dto.deadline);
        if (
          !existing.deadline ||
          candidate.getTime() !== existing.deadline.getTime()
        ) {
          newDeadline = candidate;
        }
        data.deadline = candidate;
      }

      let nextStart: Date | null | undefined;
      if (dto.scheduledStartTime !== undefined) {
        nextStart = dto.scheduledStartTime
          ? new Date(dto.scheduledStartTime)
          : null;
        data.scheduledStartTime = nextStart;
      }
      const startChanged =
        nextStart !== undefined &&
        (nextStart?.getTime() ?? null) !==
          (existing.scheduledStartTime?.getTime() ?? null);

      if (dto.tags !== undefined) {
        const cleanTags = dto.tags.map((t) => t.trim()).filter(Boolean);
        const tagIds = await this.tagsService.resolveTagIds(
          tx,
          user.id,
          cleanTags,
        );
        data.tags = { set: tagIds.map((tagId) => ({ id: tagId })) };
      }

      const orphanedSeriesId = await this.applyRecurrenceLifecycle(
        tx,
        dto,
        existing,
        data,
        user,
        now,
      );

      if (startChanged) {
        // Any manual reschedule — not just a scheduler-tracked TASK move —
        // must be remembered here, for every session type, so the ingestion
        // watchers' anti-clobber check (materializer.service.ts) warns
        // instead of silently reverting a hand-moved EXAM/LECTURE/ASSIGNMENT
        // back to its upstream (LMS/portal) position on their next sync.
        data.lastMovedAt = now;
      }

      const move = this.buildMoveEventData(existing, nextStart, startChanged);
      let firstMove: FirstMove | null = null;
      if (move) {
        const event = await tx.sessionEvent.create({
          data: moveEventData({
            sessionId: id,
            userId: user.id,
            oldStart: existing.scheduledStartTime as Date,
            oldDurationMinutes: existing.durationMinutes,
            newStart: move.movedTo,
            newDurationMinutes: dto.durationMinutes ?? existing.durationMinutes,
            dragDistanceMinutes: move.dragDistanceMinutes,
          }),
          select: { id: true },
        });
        // "First move" = the session had never been moved before this call.
        if (existing.lastMovedAt == null) {
          firstMove = {
            eventId: event.id,
            dragDistanceMinutes: move.dragDistanceMinutes,
            oldStartMs: (existing.scheduledStartTime as Date).getTime(),
            newStartMs: move.movedTo.getTime(),
          };
        }
      }

      const row = await tx.session.update({
        where: { id },
        data,
        include: WITH_TAGS_AND_SERIES,
      });
      if (orphanedSeriesId) {
        await tx.sessionSeries.delete({ where: { id: orphanedSeriesId } });
      }

      return { updated: row, newDeadline, firstMove };
    });
  }

  /**
   * Recurrence edit — whole-series. Four cases, all fixed types:
   *  · already a series, new rrule  → update the pattern, wipe exdates,
   *    re-anchor the representative to the first occurrence;
   *  · already a series, rrule null → collapse back to a one-off (the caller
   *    drops the now-empty series row after the main `session.update`);
   *  · one-off, new rrule           → spin up a series and adopt this row as
   *    its representative;
   *  · one-off, rrule null          → nothing to do.
   * Mutates `data` in place; returns the series id to delete afterward, or
   * `null`.
   */
  private async applyRecurrenceLifecycle(
    tx: Prisma.TransactionClient,
    dto: UpdateSessionDto,
    existing: SessionRow,
    data: Prisma.SessionUpdateInput,
    user: User,
    now: Date,
  ): Promise<string | null> {
    if (dto.rrule === undefined || existing.type === "TASK") return null;

    const anchorStart = () =>
      (data.scheduledStartTime as Date | undefined) ??
      existing.scheduledStartTime ??
      now;

    if (existing.seriesId && dto.rrule) {
      await tx.sessionSeries.update({
        where: { id: existing.seriesId },
        data: { rrule: dto.rrule, exdates: [] },
      });
      data.scheduledStartTime = firstOccurrence(
        dto.rrule,
        anchorStart(),
        user.timezone,
      );
      return null;
    }
    if (existing.seriesId && !dto.rrule) {
      data.series = { disconnect: true };
      return existing.seriesId;
    }
    if (!existing.seriesId && dto.rrule) {
      const series = await tx.sessionSeries.create({
        data: {
          type: existing.type,
          rrule: dto.rrule,
          deadline: null,
          userId: user.id,
        },
      });
      data.series = { connect: { id: series.id } };
      data.scheduledStartTime = firstOccurrence(
        dto.rrule,
        anchorStart(),
        user.timezone,
      );
    }
    return null;
  }

  /** `MOVE` signal for a user drag (or start-side resize) of a scheduled
   * `TASK`; `null` otherwise. An end-side resize leaves the start unchanged, so
   * it is not a move. */
  private buildMoveEventData(
    existing: SessionRow,
    nextStart: Date | null | undefined,
    startChanged: boolean,
  ): { movedTo: Date; dragDistanceMinutes: number } | null {
    const isUserTask = existing.type === "TASK" && existing.source === "USER";
    if (!isUserTask || !existing.scheduledStartTime || !startChanged) {
      return null;
    }
    const movedTo = nextStart ?? existing.scheduledStartTime;
    const dragDistanceMinutes = Math.round(
      (movedTo.getTime() - existing.scheduledStartTime.getTime()) / 60_000,
    );
    return { movedTo, dragDistanceMinutes };
  }

  /**
   * Edit-mode "session count" resize/promote (the create-mode session-count
   * slider's edit-mode counterpart). Symmetric with create: raising a plain
   * TASK's count above 1 promotes it into a series; changing an existing
   * series' count grows or shrinks it. Takes priority over deadline
   * redistribution when both are present in the same PATCH — the grow path
   * already re-places the new sittings using the row's own (possibly
   * just-updated) deadline. `null` when this PATCH isn't a resize.
   */
  private async handleSessionCountResize(
    dto: UpdateSessionDto,
    updated: SessionRow,
    user: User,
    now: Date,
  ): Promise<UpdateSessionResponse | null> {
    if (dto.sessionCount === undefined || updated.type !== "TASK") return null;

    const seriesId =
      updated.seriesId ??
      (dto.sessionCount > 1
        ? await this.series.promoteToSeries(
            updated.id,
            updated.deadline as Date,
            user,
          )
        : null);
    if (!seriesId) return null;

    const seriesSessions = await this.series.resizeSessionCount(
      seriesId,
      dto.sessionCount,
      user,
      now,
    );
    const rep =
      seriesSessions.find((s) => s.id === updated.id) ?? seriesSessions[0];
    return { ...rep, ...NO_SLOT_PROPOSAL, sessions: seriesSessions };
  }

  /**
   * A deadline change re-places just the affected TASK — a standalone task
   * into its new best empty slot, or a whole series redistributed across the
   * new window. No other session is ever moved. `null` when this PATCH isn't
   * a deadline change on a `TASK`.
   */
  private async handleDeadlineRedistribution(
    newDeadline: Date | null,
    updated: SessionRow,
    user: User,
    now: Date,
    infeasiblePolicy?: InfeasiblePolicy,
  ): Promise<UpdateSessionResponse | null> {
    if (!newDeadline || updated.type !== "TASK") return null;

    if (updated.seriesId && updated.series?.type === "TASK") {
      const { sessions: seriesSessions, degraded } =
        await this.series.redistribute(
          updated.seriesId,
          user,
          newDeadline,
          now,
        );
      const rep =
        seriesSessions.find((s) => s.id === updated.id) ?? seriesSessions[0];
      return {
        ...rep,
        ...NO_SLOT_PROPOSAL,
        sessions: seriesSessions,
        ...(degraded ? { schedulingDegraded: true } : {}),
      };
    }

    const placement = await this.taskPlacement.placeOnDeadlineChange({
      user,
      task: {
        id: updated.id,
        durationMinutes: updated.durationMinutes,
        deadline: newDeadline,
        prevStartMs: updated.scheduledStartTime?.getTime(),
      },
      now,
      infeasiblePolicy,
    });
    return toUpdateSessionResponse(
      {
        ...updated,
        scheduledStartTime:
          placement.scheduledStartTime ?? updated.scheduledStartTime,
      },
      slotProposalFieldsOf(placement),
    );
  }

  /**
   * "All occurrences" (scope "series", or omitted — today's default
   * whole-series reanchor) with `skipConflicting`: the reanchor already moved
   * every occurrence's time-of-day at once (it's virtual — one representative
   * row), so prune out whichever upcoming landings now collide instead of
   * leaving them overlapping. Returns the pruned ids, or `undefined` when
   * this PATCH doesn't call for pruning.
   */
  private async pruneConflictingOccurrences(
    occ: OccurrenceRef | null,
    dto: UpdateSessionDto,
    updated: SessionRow,
    now: Date,
    user: User,
  ): Promise<string[] | undefined> {
    if (
      !(
        occ &&
        dto.skipConflicting &&
        (dto.scope === "series" || dto.scope === undefined) &&
        updated.seriesId &&
        updated.series?.rrule &&
        updated.scheduledStartTime
      )
    ) {
      return undefined;
    }

    const seriesId = updated.seriesId;
    const scanEnd = new Date(now.getTime() + MAX_SCAN_DAYS * DAY_MS);
    const occStarts = expandRrule(
      updated.series.rrule,
      updated.scheduledStartTime,
      now,
      scanEnd,
      user.timezone,
      updated.series.exdates,
    );
    const skipped: string[] = [];
    for (const occStart of occStarts) {
      const conflict = await wouldConflict(this.prisma, {
        userId: user.id,
        timezone: user.timezone,
        start: occStart,
        durationMinutes: updated.durationMinutes,
        excludeSessionIds: [updated.id],
        excludeSeriesId: seriesId,
      });
      if (conflict) {
        await this.series.excludeOccurrence(
          seriesId,
          occStart.toISOString(),
          user,
        );
        skipped.push(occurrenceId(seriesId, occStart));
      }
    }
    return skipped.length ? skipped : undefined;
  }
}
