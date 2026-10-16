import { Injectable } from "@nestjs/common";
import { Prisma, SessionEventType } from "../../../generated/prisma";
import { PrismaService } from "../../prisma/prisma.service";
import { SESSION_SYSTEM_MOVE_REWARD } from "../constants";
import { MS_PER_MINUTE } from "../core/slot";
import { schedulerSessionEvents } from "../../observability/metrics";
import type { ScheduleItem } from "./day-load";

/** A moved flexible task, ready for the wire / a `SYSTEM_MOVE` event. */
export interface AppliedMove {
  id: string;
  from: Date;
  to: Date;
}

/** A displacement move as produced by Python's `/v1/place` response. */
export interface DisplacementMove {
  id: string;
  fromMs: number;
  toMs: number;
}

/** Only standalone scheduled TASK rows are movable; everything else is fixed. */
export const isFlexible = (it: ScheduleItem): boolean =>
  !it.recurring &&
  it.type === "TASK" &&
  it.seriesId === null &&
  it.id !== null &&
  it.deadlineMs !== null;

/**
 * I/O half of displacement (issue #62 B): persists a plan's moves — computed
 * by Python's `/v1/place` (ADR-0003; displacement planning itself lives in
 * `services/bandit/src/core`) — as scheduler-initiated `SYSTEM_MOVE` events
 * (reward 0, no preference update — a user `MOVE` reward/penalty is never
 * generated for these). Used by `PythonPlacer`, `ConflictRescheduleService`
 * and the confirm path of `PlacementPlanService`.
 */
@Injectable()
export class DisplacementService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Persists a plan's moves: one `SYSTEM_MOVE` event per moved task (reward 0)
   * and the new `scheduledStartTime`, in one transaction. No `MOVE` event, no
   * `SchedulingFeedback` call — the bandit and preference matrix never see it.
   * `groupId` ties the events to one undo entry (`POST /sessions/undo/:groupId`).
   */
  async applyMoves(
    userId: string,
    moves: DisplacementMove[],
    durationOf: (id: string) => number,
    groupId?: string,
  ): Promise<AppliedMove[]> {
    if (moves.length === 0) return [];
    await this.prisma.$transaction(
      this.moveWrites(this.prisma, userId, moves, durationOf, groupId),
    );
    schedulerSessionEvents.add(moves.length, {
      type: SessionEventType.SYSTEM_MOVE,
    });
    return moves.map((m) => ({
      id: m.id,
      from: new Date(m.fromMs),
      to: new Date(m.toMs),
    }));
  }

  /**
   * The unexecuted writes behind {@link applyMoves}, so a caller can run them
   * in its own transaction next to other writes.
   */
  moveWrites(
    db: Prisma.TransactionClient | PrismaService,
    userId: string,
    moves: DisplacementMove[],
    durationOf: (id: string) => number,
    groupId?: string,
  ): Prisma.PrismaPromise<unknown>[] {
    return moves.flatMap((m) => [
      db.session.update({
        where: { id: m.id },
        data: { scheduledStartTime: new Date(m.toMs) },
      }),
      db.sessionEvent.create({
        data: {
          sessionId: m.id,
          userId,
          eventType: SessionEventType.SYSTEM_MOVE,
          oldSnapshot: {
            scheduledStartTime: new Date(m.fromMs).toISOString(),
            durationMinutes: durationOf(m.id),
          },
          newSnapshot: {
            scheduledStartTime: new Date(m.toMs).toISOString(),
            durationMinutes: durationOf(m.id),
          },
          dragDistanceMinutes: Math.round((m.toMs - m.fromMs) / MS_PER_MINUTE),
          rewardScore: SESSION_SYSTEM_MOVE_REWARD,
          ...(groupId ? { groupId } : {}),
        },
      }),
    ]);
  }
}
