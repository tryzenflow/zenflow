import { Injectable, NotFoundException } from "@nestjs/common";
import type { UpdateSessionResponse } from "@zenflow/shared";
import { Prisma, type User } from "../../generated/prisma";
import { PrismaService } from "../prisma/prisma.service";
import { TagsService } from "../tags/tags.service";
import { TaskPlacementService } from "../scheduler/io/task-placement.service";
import { SchedulingFeedbackService } from "../scheduler/io/scheduling-feedback.service";
import {
  firstOccurrence,
  parseOccurrenceId,
  reanchorTimeOfDay,
} from "../scheduler/core/recurrence";
import { UpdateSessionDto } from "./dto/update-session.dto";
import { SessionRow, WITH_TAGS_AND_SERIES } from "./types/session-row";
import { toSessionDto } from "./session-mapper";
import { moveEventData } from "./session-events";
import { mapSessionPrismaError } from "./prisma-error";
import { SeriesService } from "./series.service";

/**
 * `PATCH /sessions/:id` — a plain field diff, plus (for fixed types) the
 * whole-series recurrence lifecycle, the `MOVE` telemetry + first-move LinUCB
 * reward for a user drag/resize of a scheduled `TASK`, and — on a deadline
 * change — a single re-placement (standalone task) or series redistribution.
 * Never auto-searches otherwise; no other session is ever moved.
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
      let newDeadline: Date | null = null;
      let firstMove: { eventId: bigint; dragDistanceMinutes: number } | null =
        null;

      // A recurring occurrence ref ("<seriesId>::<startISO>") edits its series
      // through the representative row: metadata applies series-wide; a
      // `scheduledStartTime` change shifts only the *time of day* (the
      // first-occurrence date is kept so the rrule anchor can't drop earlier
      // occurrences).
      const occ = parseOccurrenceId(id);
      if (occ) {
        const rep = await this.prisma.session.findFirst({
          where: { seriesId: occ.seriesId, userId: user.id },
          select: { id: true, scheduledStartTime: true },
        });
        if (!rep)
          throw new NotFoundException(`Cannot find session with id ${id}`);
        id = rep.id;
        if (dto.scheduledStartTime && rep.scheduledStartTime) {
          dto.scheduledStartTime = reanchorTimeOfDay(
            rep.scheduledStartTime,
            new Date(dto.scheduledStartTime),
            user.timezone,
          ).toISOString();
        }
      }

      const updated = await this.prisma.$transaction(
        async (tx): Promise<SessionRow> => {
          const existing = await tx.session.findFirst({
            where: { id, userId: user.id },
            include: { tags: true },
          });
          if (!existing)
            throw new NotFoundException(`Cannot find session with id ${id}`);

          const data: Prisma.SessionUpdateInput = {};
          if (dto.title !== undefined) data.title = dto.title;
          if (dto.note !== undefined) data.note = dto.note;

          const durationChanged =
            dto.durationMinutes !== undefined &&
            dto.durationMinutes !== existing.durationMinutes;
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

          // Recurrence edit — whole-series. Four cases, all fixed types:
          //  · already a series, new rrule  → update the pattern, wipe exdates,
          //    re-anchor the representative to the first occurrence;
          //  · already a series, rrule null → collapse back to a one-off (drop
          //    the now-empty series row);
          //  · one-off, new rrule           → spin up a series and adopt this
          //    row as its representative;
          //  · one-off, rrule null          → nothing to do.
          let orphanedSeriesId: string | null = null;
          if (dto.rrule !== undefined && existing.type !== "TASK") {
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
            } else if (existing.seriesId && !dto.rrule) {
              data.series = { disconnect: true };
              orphanedSeriesId = existing.seriesId;
            } else if (!existing.seriesId && dto.rrule) {
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
          }

          // MOVE signal — user drag/resize of a scheduled TASK.
          const isUserTask =
            existing.type === "TASK" && existing.source === "USER";
          if (
            isUserTask &&
            existing.scheduledStartTime &&
            (startChanged || durationChanged)
          ) {
            const movedTo =
              nextStart === undefined
                ? existing.scheduledStartTime
                : (nextStart ?? existing.scheduledStartTime);
            const dragDistanceMinutes = startChanged
              ? Math.round(
                  (movedTo.getTime() - existing.scheduledStartTime.getTime()) /
                    60_000,
                )
              : 0;
            const moveEvent = await tx.sessionEvent.create({
              data: moveEventData({
                sessionId: id,
                userId: user.id,
                oldStart: existing.scheduledStartTime,
                oldDurationMinutes: existing.durationMinutes,
                newStart: movedTo,
                newDurationMinutes:
                  dto.durationMinutes ?? existing.durationMinutes,
                dragDistanceMinutes,
              }),
              select: { id: true },
            });
            // "First move" = the session had never been moved before this call.
            if (existing.lastMovedAt == null) {
              firstMove = { eventId: moveEvent.id, dragDistanceMinutes };
            }
            data.lastMovedAt = now;
          }

          const row = await tx.session.update({
            where: { id },
            data,
            include: WITH_TAGS_AND_SERIES,
          });
          if (orphanedSeriesId) {
            await tx.sessionSeries.delete({ where: { id: orphanedSeriesId } });
          }
          return row;
        },
      );

      // First user move of a LinUCB-placed session → delayed graded reward.
      const fm = firstMove as {
        eventId: bigint;
        dragDistanceMinutes: number;
      } | null;
      if (fm) {
        await this.schedulingFeedback.onFirstMove(
          user.id,
          id,
          fm.eventId,
          fm.dragDistanceMinutes,
        );
      }

      // A deadline change re-places just the affected TASK — a standalone task
      // into its new best empty slot, or a whole series redistributed across the
      // new window. No other session is ever moved.
      if (newDeadline && updated.type === "TASK") {
        if (updated.seriesId && updated.series?.type === "TASK") {
          const seriesSessions = await this.series.redistribute(
            updated.seriesId,
            user,
            newDeadline,
            now,
          );
          const rep =
            seriesSessions.find((s) => s.id === updated.id) ??
            seriesSessions[0];
          return { ...rep, sessions: seriesSessions };
        }

        const { scheduledStartTime } =
          await this.taskPlacement.placeOnDeadlineChange({
            user,
            task: {
              id: updated.id,
              durationMinutes: updated.durationMinutes,
              deadline: newDeadline,
            },
            now,
          });
        return toSessionDto({
          ...updated,
          scheduledStartTime: scheduledStartTime ?? updated.scheduledStartTime,
        });
      }

      return toSessionDto(updated);
    } catch (error) {
      mapSessionPrismaError(error, id, "update");
    }
  }
}
