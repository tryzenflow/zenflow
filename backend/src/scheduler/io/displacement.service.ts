import { Injectable } from "@nestjs/common";
import { SessionEventType } from "../../../generated/prisma";
import { PrismaService } from "../../prisma/prisma.service";
import { SESSION_SYSTEM_MOVE_REWARD } from "../constants";
import { MS_PER_MINUTE } from "../core/slot";
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
 * generated for these). Used by `PythonPlacer` and
 * `ConflictRescheduleService`.
 */
@Injectable()
export class DisplacementService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Persists a plan's moves: one `SYSTEM_MOVE` event per moved task (reward 0)
   * and the new `scheduledStartTime`, in one transaction. No `MOVE` event, no
   * `SchedulingFeedback` call — the bandit and preference matrix never see it.
   */
  async applyMoves(
    userId: string,
    moves: DisplacementMove[],
    durationOf: (id: string) => number,
  ): Promise<AppliedMove[]> {
    if (moves.length === 0) return [];
    await this.prisma.$transaction(
      moves.flatMap((m) => [
        this.prisma.session.update({
          where: { id: m.id },
          data: { scheduledStartTime: new Date(m.toMs) },
        }),
        this.prisma.sessionEvent.create({
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
            dragDistanceMinutes: Math.round(
              (m.toMs - m.fromMs) / MS_PER_MINUTE,
            ),
            rewardScore: SESSION_SYSTEM_MOVE_REWARD,
          },
        }),
      ]),
    );
    return moves.map((m) => ({
      id: m.id,
      from: new Date(m.fromMs),
      to: new Date(m.toMs),
    }));
  }
}
