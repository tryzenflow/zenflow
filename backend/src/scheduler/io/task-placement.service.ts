import { BadRequestException, Injectable } from "@nestjs/common";
import type { InfeasiblePolicy } from "@zenflow/shared";
import { type User } from "../../../generated/prisma";
import { withSpan } from "../../observability/otel";
import { PrismaService } from "../../prisma/prisma.service";
import { PythonPlacer } from "./python-placer.service";
import { ScheduleInfeasibleException } from "../schedule-infeasible.exception";
import { blocksPlacement, ceilToSlot, MS_PER_MINUTE } from "../core/slot";
import type {
  PlaceableTask,
  PlacementResult,
  SeriesMemberInput,
  SeriesPlacementRow,
} from "../types/placement.types";

type Trigger = "create" | "deadline-change";

/**
 * The single placement entry point `sessions/` talks to. It owns the whole
 * "place a `TASK` and persist its `scheduledStartTime`" flow by delegating to
 * {@link PythonPlacer} (ADR-0003: Python owns ranking; Nest gathers, calls,
 * applies, persists). A Python failure falls back to the frozen TS heuristic
 * (`FallbackPlacer`, driven from inside `PythonPlacer`) — this service never
 * runs its own ranking.
 */
@Injectable()
export class TaskPlacementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly python: PythonPlacer,
  ) {}

  /** Place a freshly-created single `TASK`. */
  placeOnCreate(args: {
    user: User;
    task: PlaceableTask;
    now: Date;
    infeasiblePolicy?: InfeasiblePolicy;
  }): Promise<PlacementResult> {
    return this.placeSingle(
      args.user,
      args.task,
      "create",
      args.now,
      args.infeasiblePolicy,
    );
  }

  /** Re-place a single `TASK` after its deadline changed. */
  placeOnDeadlineChange(args: {
    user: User;
    task: PlaceableTask;
    now: Date;
    infeasiblePolicy?: InfeasiblePolicy;
  }): Promise<PlacementResult> {
    return this.placeSingle(
      args.user,
      args.task,
      "deadline-change",
      args.now,
      args.infeasiblePolicy,
    );
  }

  private placeSingle(
    user: User,
    task: PlaceableTask,
    trigger: Trigger,
    now: Date,
    policy?: InfeasiblePolicy,
  ): Promise<PlacementResult> {
    return withSpan(
      "scheduler.placeSingle",
      () => this.python.placeSingle(user, task, trigger, now, policy),
      { "scheduling.trigger": trigger, "session.id": task.id },
    );
  }

  /**
   * Read-only guard for a single `TASK` create / deadline edit, run BEFORE
   * anything is written: rejects a deadline too close for the duration (400),
   * and — when no slot exists — throws the 409 `ScheduleInfeasibleException`
   * (via `PythonPlacer`) unless the request already carries an
   * `infeasiblePolicy`. `taskId` (edit path) excludes the task itself.
   */
  async preflightTask(args: {
    user: User;
    taskId?: string;
    durationMinutes: number;
    deadline: Date;
    now: Date;
    policy?: InfeasiblePolicy;
    /** Series member edit: only the `now + duration > deadline` arithmetic guard. */
    arithmeticOnly?: boolean;
  }): Promise<void> {
    const { user, durationMinutes, deadline, now } = args;
    if (
      ceilToSlot(now.getTime()) + durationMinutes * MS_PER_MINUTE >
      deadline.getTime()
    ) {
      throw new BadRequestException(
        "Won't fit before the deadline\nPick a later deadline.",
      );
    }
    if (args.arithmeticOnly) return;
    await this.python.preflightSingle({
      user,
      taskId: args.taskId,
      durationMinutes,
      deadline,
      now,
      policy: args.policy,
    });
  }

  /**
   * Read-only pre-flight feasibility check for a single `TASK` create — `true`
   * iff at least one empty slot fits `durationMinutes` somewhere in
   * `now … deadline`. No DB write, no telemetry.
   */
  async canPlaceTask(args: {
    user: User;
    durationMinutes: number;
    deadline: Date;
    now: Date;
  }): Promise<boolean> {
    try {
      await this.python.preflightSingle(args);
      return true;
    } catch (err) {
      if (err instanceof ScheduleInfeasibleException) return false;
      throw err;
    }
  }

  /**
   * Read-only pre-flight feasibility check for a `TASK` series create —
   * `true` iff EVERY member (`sessionCount` sittings of `durationMinutes`)
   * can be placed somewhere in `now … deadline`. One infeasible member fails
   * the whole check, so `SessionCrudService.create` can reject the batch
   * before any row exists — no partially-placed series is ever persisted.
   */
  canPlaceSeries(args: {
    user: User;
    durationMinutes: number;
    sessionCount: number;
    deadline: Date;
    now: Date;
  }): Promise<boolean> {
    return this.python.canPlaceSeries(args);
  }

  async placeSeriesOnCreate(args: {
    user: User;
    seriesId: string;
    members: SeriesMemberInput[];
    deadline: Date;
    now: Date;
  }): Promise<SeriesPlacementRow[]> {
    const { user, members, deadline, now } = args;
    return this.python.placeSeries({
      user,
      members,
      deadline,
      now,
      trigger: "create",
    });
  }

  /**
   * A `TASK` series' deadline moved: push the new `deadline` onto the series row
   * and every member, then re-run the series placement for the sittings that
   * have not started yet. Past sittings keep their slot and are held clear as
   * `fixedOccupied`. Returns one row per member in the given order.
   */
  async redistributeSeries(args: {
    user: User;
    seriesId: string;
    members: {
      id: string;
      durationMinutes: number;
      scheduledStartTime: Date | null;
    }[];
    newDeadline: Date;
    now: Date;
  }): Promise<SeriesPlacementRow[]> {
    const { user, seriesId, members, newDeadline, now } = args;

    const isPast = (s: { scheduledStartTime: Date | null }) =>
      s.scheduledStartTime != null &&
      s.scheduledStartTime.getTime() < now.getTime();
    const upcoming = members.filter((m) => !isPast(m));
    const fixedOccupied = members
      .filter((m) => isPast(m) && blocksPlacement(m.durationMinutes))
      .map((m) => ({
        start: (m.scheduledStartTime as Date).getTime(),
        end:
          (m.scheduledStartTime as Date).getTime() + m.durationMinutes * 60_000,
      }));

    const upcomingMembers = upcoming.map((m) => ({
      id: m.id,
      durationMinutes: m.durationMinutes,
    }));
    const placements = await this.python.placeSeries({
      user,
      members: upcomingMembers,
      deadline: newDeadline,
      now,
      trigger: "deadline-change",
      fixedOccupied,
    });
    const startById = new Map(
      placements.map((p) => [p.id, p.scheduledStartTime]),
    );

    await this.prisma.$transaction([
      this.prisma.sessionSeries.update({
        where: { id: seriesId },
        data: { deadline: newDeadline },
      }),
      this.prisma.session.updateMany({
        where: { seriesId, userId: user.id },
        data: { deadline: newDeadline },
      }),
      ...upcoming.map((m) =>
        this.prisma.session.update({
          where: { id: m.id },
          data: { scheduledStartTime: startById.get(m.id) ?? null },
        }),
      ),
    ]);

    const degraded = placements.some((p) => p.degraded);
    return members.map((m) => ({
      id: m.id,
      scheduledStartTime: isPast(m)
        ? m.scheduledStartTime
        : (startById.get(m.id) ?? null),
      ...(degraded ? { degraded: true } : {}),
    }));
  }
}
