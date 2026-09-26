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

  /**
   * Re-place a single `TASK` after its deadline changed. `allowLastResort:
   * false` returns a `null` start (nothing written) instead of the last
   * resort — only for callers whose task already has a start to keep.
   */
  placeOnDeadlineChange(args: {
    user: User;
    task: PlaceableTask;
    now: Date;
    infeasiblePolicy?: InfeasiblePolicy;
    allowLastResort?: boolean;
  }): Promise<PlacementResult> {
    return this.placeSingle(
      args.user,
      args.task,
      "deadline-change",
      args.now,
      args.infeasiblePolicy,
      args.allowLastResort ?? true,
    );
  }

  private placeSingle(
    user: User,
    task: PlaceableTask,
    trigger: Trigger,
    now: Date,
    policy?: InfeasiblePolicy,
    allowLastResort = true,
  ): Promise<PlacementResult> {
    return withSpan(
      "scheduler.placeSingle",
      () =>
        this.python.placeSingle(
          user,
          task,
          trigger,
          now,
          policy,
          allowLastResort,
        ),
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
    const placements = await this.python.placeSeries({
      user,
      members,
      deadline,
      now,
      trigger: "create",
    });
    // `placeSeries` only computes starts; persist them here.
    await this.persistPlaced(placements);
    return placements;
  }

  /** Write each member's start (`placeSeries` never returns a `null` one). */
  private async persistPlaced(rows: SeriesPlacementRow[]): Promise<void> {
    const placed = rows.filter((p) => p.scheduledStartTime);
    if (placed.length === 0) return;
    await this.prisma.$transaction(
      placed.map((p) =>
        this.prisma.session.update({
          where: { id: p.id },
          data: { scheduledStartTime: p.scheduledStartTime },
        }),
      ),
    );
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

    const { isPast, upcoming, placements } = await this.placeUpcoming(
      user,
      members,
      newDeadline,
      now,
    );
    const startById = new Map(
      placements.map((p) => [p.id, p.scheduledStartTime]),
    );
    const placementById = new Map(placements.map((p) => [p.id, p]));

    await this.prisma.$transaction([
      this.prisma.sessionSeries.update({
        where: { id: seriesId },
        data: { deadline: newDeadline },
      }),
      this.prisma.session.updateMany({
        where: { seriesId, userId: user.id },
        data: { deadline: newDeadline },
      }),
      // Never writes a `null` start: `placeSeries` gives every member one.
      ...upcoming.flatMap((m) => {
        const start = startById.get(m.id);
        return start
          ? [
              this.prisma.session.update({
                where: { id: m.id },
                data: { scheduledStartTime: start },
              }),
            ]
          : [];
      }),
    ]);

    const degraded = placements.some((p) => p.degraded);
    // Past sittings were not re-placed: no proposal, no alternative.
    return members.map((m) => {
      const p = isPast(m) ? undefined : placementById.get(m.id);
      return {
        id: m.id,
        scheduledStartTime: isPast(m)
          ? m.scheduledStartTime
          : (startById.get(m.id) ?? m.scheduledStartTime),
        slotProposalId: p?.slotProposalId ?? null,
        alternativeSlot: p?.alternativeSlot ?? null,
        divergent: p?.divergent ?? false,
        ...(degraded ? { degraded: true } : {}),
      };
    });
  }

  /**
   * Re-spread a `TASK` series' upcoming sittings without persisting (sync
   * conflict "Reschedule them all"). Returns `{ id, from, to }` per sitting
   * (`to` null = no real slot: a last-resort pick would only trade one
   * conflict for another, so the caller falls back to one-by-one moves).
   */
  async planSeriesRespread(args: {
    user: User;
    seriesId: string;
    deadline: Date;
    now: Date;
  }): Promise<{ id: string; from: Date | null; to: Date | null }[]> {
    const { user, seriesId, deadline, now } = args;
    const members = await this.prisma.session.findMany({
      where: { seriesId, userId: user.id, type: "TASK", deleted: false },
      select: { id: true, durationMinutes: true, scheduledStartTime: true },
      orderBy: { scheduledStartTime: "asc" },
    });
    // Never shown as a pairwise choice: record no `pairwiseShown`.
    const { upcoming, placements } = await this.placeUpcoming(
      user,
      members,
      deadline,
      now,
      false,
    );
    const toById = new Map(
      placements.map((p) => [p.id, p.lastResort ? null : p.scheduledStartTime]),
    );
    return upcoming.map((m) => ({
      id: m.id,
      from: m.scheduledStartTime,
      to: toById.get(m.id) ?? null,
    }));
  }

  /**
   * Started sittings keep their slot (as `fixedOccupied`); the rest are
   * placed together via `placeSeries`.
   */
  private async placeUpcoming<
    M extends {
      id: string;
      durationMinutes: number;
      scheduledStartTime: Date | null;
    },
  >(
    user: User,
    members: M[],
    deadline: Date,
    now: Date,
    surfaceAlternatives = true,
  ) {
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

    const placements = await this.python.placeSeries({
      user,
      members: upcoming.map((m) => ({
        id: m.id,
        durationMinutes: m.durationMinutes,
      })),
      deadline,
      now,
      trigger: "deadline-change",
      fixedOccupied,
      ...(surfaceAlternatives ? {} : { surfaceAlternatives: false }),
    });
    return { isPast, upcoming, placements };
  }
}
