import { Injectable } from "@nestjs/common";
import type { DayRescheduleDiff, DayRescheduleResult } from "@zenflow/shared";
import {
  Prisma,
  SessionEventType,
  SessionSource,
  SessionStatus,
  type Session,
} from "../../generated/prisma";
import { PrismaService } from "../prisma/prisma.service";
import { HeuristicSession, optimize } from "./heuristic";
import type { Interval } from "./utils/slot";
import { minutesToUtc } from "../common/utils";

/** Shape stored in `SessionEvent.oldSnapshot`/`newSnapshot` for a RESCHEDULED event. */
interface ScheduledStartSnapshot {
  scheduledStartTime: string | null;
}

/**
 * The ONLY layer that touches Prisma for the heuristic scheduler (CLAUDE.md
 * invariant #2 — pure core / I/O split). Wraps the pure {@link optimize}
 * function (`heuristic.ts`) with candidate loading + telemetry, scoped to a
 * SINGLE calendar day.
 *
 * There is no manual "Optimize" endpoint any more (see
 * `docs/adr/0001-phase-2-scheduling-heuristic-and-transparency-ui.md` for the
 * dropped surface). Instead this runs IMPLICITLY: `SessionsService` calls it
 * right after creating a session or after an edit that changes a session's
 * deadline, repacking just the affected day. No preview, no undo.
 */
@Injectable()
export class DayRescheduleService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Optimize every movable session touching `dayLocalDateStr` (in
   * `timezone`) and apply the result immediately. Only PENDING, user-created
   * sessions (`source: USER`) are candidates — LMS/PORTAL rows are fixed
   * lecture/exam times the student can't move.
   */
  async rescheduleDay(
    userId: string,
    dayLocalDateStr: string,
    timezone: string,
    preferenceMatrix: number[],
    now: Date,
  ): Promise<DayRescheduleResult> {
    const dayStart = minutesToUtc(dayLocalDateStr, 0, timezone);
    const dayEnd = minutesToUtc(dayLocalDateStr, 1439, timezone);
    const windowStart = now > dayStart ? now : dayStart;

    const candidates = await this.prisma.session.findMany({
      where: {
        userId,
        status: SessionStatus.PENDING,
        source: SessionSource.USER,
        OR: [
          { deadline: { gte: dayStart, lte: dayEnd } },
          { scheduledStartTime: { gte: dayStart, lte: dayEnd } },
        ],
      },
    });

    if (candidates.length === 0) return { date: dayLocalDateStr, diffs: [] };

    const candidateIds = candidates.map((c) => c.id);
    const others = await this.prisma.session.findMany({
      where: {
        userId,
        id: { notIn: candidateIds },
        scheduledStartTime: { gte: dayStart, lte: dayEnd },
      },
      select: { scheduledStartTime: true, durationMinutes: true },
    });

    const occupied: Interval[] = others.map((o) => ({
      start: o.scheduledStartTime!.getTime(),
      end: o.scheduledStartTime!.getTime() + o.durationMinutes * 60_000,
    }));

    const heuristicSessions: HeuristicSession[] = candidates.map((c) => ({
      id: c.id,
      durationMinutes: c.durationMinutes,
      deadline: c.deadline,
      scheduledStartTime: c.scheduledStartTime,
    }));

    const placements = optimize(
      heuristicSessions,
      occupied,
      now,
      windowStart,
      dayEnd,
      preferenceMatrix,
      timezone,
    );

    const byId = new Map<string, Session>(candidates.map((c) => [c.id, c]));
    const moved = placements.filter((p) => {
      const original = byId.get(p.id);
      const originalTime = original?.scheduledStartTime?.getTime() ?? null;
      return originalTime !== p.scheduledStartTime.getTime();
    });

    if (moved.length === 0) return { date: dayLocalDateStr, diffs: [] };

    const diffs: DayRescheduleDiff[] = [];

    await this.prisma.$transaction(async (tx) => {
      for (const placement of moved) {
        const original = byId.get(placement.id)!;
        const oldSnapshot: ScheduledStartSnapshot = {
          scheduledStartTime: original.scheduledStartTime
            ? original.scheduledStartTime.toISOString()
            : null,
        };
        const newSnapshot: ScheduledStartSnapshot = {
          scheduledStartTime: placement.scheduledStartTime.toISOString(),
        };

        await tx.session.update({
          where: { id: placement.id },
          data: { scheduledStartTime: placement.scheduledStartTime },
        });
        await tx.sessionEvent.create({
          data: {
            sessionId: placement.id,
            userId,
            eventType: SessionEventType.RESCHEDULED,
            oldSnapshot: oldSnapshot as unknown as Prisma.InputJsonValue,
            newSnapshot: newSnapshot as unknown as Prisma.InputJsonValue,
          },
        });

        diffs.push({
          id: placement.id,
          title: original.title,
          oldScheduledStartTime: oldSnapshot.scheduledStartTime,
          newScheduledStartTime: placement.scheduledStartTime.toISOString(),
        });
      }
    });

    return { date: dayLocalDateStr, diffs };
  }
}
