import { Injectable } from "@nestjs/common";
import type { InfeasiblePolicy } from "@zenflow/shared";
import { SessionEventType, type User } from "../../../generated/prisma";
import { PrismaService } from "../../prisma/prisma.service";
import { minutesToUtc } from "../../common/utils";
import { SESSION_SYSTEM_MOVE_REWARD } from "../constants";
import {
  pickLateSlot,
  pickMinConflictSlot,
  planDisplacement,
  type DisplacementMove,
  type DisplacementPlan,
  type FlexibleTask,
} from "../core/displacement";
import {
  addDaysStr,
  blocksPlacement,
  DAY_MS,
  localDateStr,
  MS_PER_MINUTE,
  type Interval,
} from "../core/slot";
import { loadScheduleItems, type ScheduleItem } from "./day-load";
import type { PlaceableTask } from "../types/placement.types";

/** A moved flexible task, ready for the wire / a `SYSTEM_MOVE` event. */
export interface AppliedMove {
  id: string;
  from: Date;
  to: Date;
}

/** Only standalone scheduled TASK rows are movable; everything else is fixed. */
export const isFlexible = (it: ScheduleItem): boolean =>
  !it.recurring &&
  it.type === "TASK" &&
  it.seriesId === null &&
  it.id !== null &&
  it.deadlineMs !== null;

/**
 * I/O half of displacement (issue #62 B): loads the deadline-day window,
 * asks the pure {@link planDisplacement} for a repack, persists the moves as
 * scheduler-initiated `SYSTEM_MOVE` events (reward 0, no preference update —
 * a user `MOVE` reward/penalty is never generated for these), and resolves the
 * user's "accept conflicts" / "accept late deadline" fallbacks.
 */
@Injectable()
export class DisplacementService {
  constructor(private readonly prisma: PrismaService) {}

  /** Read-only plan for placing `task` by repacking flexible tasks. */
  async plan(
    user: User,
    task: PlaceableTask,
    now: Date,
  ): Promise<DisplacementPlan> {
    const tz = user.timezone;
    const deadlineDay = localDateStr(new Date(task.deadline.getTime() - 1), tz);
    const dayStart = minutesToUtc(deadlineDay, 0, tz).getTime();
    const dayEnd = minutesToUtc(addDaysStr(deadlineDay, 1), 0, tz).getTime();

    const items = await loadScheduleItems(this.prisma, {
      userId: user.id,
      rangeStartMs: dayStart - DAY_MS,
      rangeEndMs: dayEnd + DAY_MS,
      timezone: tz,
      excludeSessionIds: [task.id],
    });

    const flexible: FlexibleTask[] = items.filter(isFlexible).map((it) => ({
      id: it.id as string,
      durationMinutes: it.durationMinutes,
      deadlineMs: it.deadlineMs as number,
      startMs: it.start,
    }));
    const fixed: Interval[] = items
      .filter((it) => !isFlexible(it) && blocksPlacement(it.durationMinutes))
      .map((it) => ({ start: it.start, end: it.end }));

    return planDisplacement({
      task: {
        durationMinutes: task.durationMinutes,
        deadlineMs: task.deadline.getTime(),
      },
      flexible,
      fixed,
      nowMs: now.getTime(),
      // Deadline day first; widen to +/-1 day only if that is infeasible.
      windows: [
        { startMs: dayStart, endMs: dayEnd },
        { startMs: dayStart - DAY_MS, endMs: dayEnd + DAY_MS },
      ],
      prefMatrix: user.preferenceMatrix,
      timezone: tz,
    });
  }

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

  /** The start for the user's chosen fallback, or `null`. */
  async fallbackStart(
    user: User,
    task: PlaceableTask,
    now: Date,
    policy: InfeasiblePolicy,
  ): Promise<Date | null> {
    const deadlineMs = task.deadline.getTime();
    const horizonEndMs = deadlineMs + 30 * DAY_MS;
    const items = await loadScheduleItems(this.prisma, {
      userId: user.id,
      rangeStartMs: now.getTime(),
      rangeEndMs: horizonEndMs,
      timezone: user.timezone,
      excludeSessionIds: [task.id],
    });
    const occupied = items
      .filter((it) => blocksPlacement(it.durationMinutes))
      .map((it) => ({ start: it.start, end: it.end }));
    const args = {
      durationMinutes: task.durationMinutes,
      nowMs: now.getTime(),
      deadlineMs,
      occupied,
      prefMatrix: user.preferenceMatrix,
      timezone: user.timezone,
      horizonEndMs,
    };
    const ms =
      policy === "ACCEPT_CONFLICTS"
        ? pickMinConflictSlot(args)
        : pickLateSlot(args);
    return ms === null ? null : new Date(ms);
  }
}
