import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { InfeasiblePolicy } from "@zenflow/shared";
import { SchedulingModel, type User } from "../../../generated/prisma";
import type { Span } from "@opentelemetry/api";
import { withSpan } from "../../observability/otel";
import {
  schedulerAppliedPolicy,
  schedulerBanditFallback,
} from "../../observability/metrics";
import { PrismaService } from "../../prisma/prisma.service";
import { HeuristicPlacer } from "./heuristic-placer.service";
import { BanditPlacer } from "./bandit-placer.service";
import { SeriesPlacer } from "./series-placer.service";
import { DisplacementService, type AppliedMove } from "./displacement.service";
import { PythonPlacer } from "./python-placer.service";
import { parsePlacementMode, type PlacementMode } from "./placement-mode";
import { ScheduleInfeasibleException } from "../schedule-infeasible.exception";
import { blocksPlacement, ceilToSlot, MS_PER_MINUTE } from "../core/slot";
import {
  SchedulingExperimentCoordinator,
  type ExperimentPlacementOutcome,
} from "./scheduling-experiment-coordinator.service";
import type {
  PlaceableTask,
  PlacementResult,
  SeriesMemberInput,
  SeriesPlacementRow,
} from "../types/placement.types";

type Trigger = "create" | "deadline-change";

/** Placeholder id for a pre-flight feasibility scan — no `Session` row exists
 * yet, so this never matches a real occupied interval to exclude. */
const PREFLIGHT_TASK_ID = "__preflight__";

/**
 * The single placement entry point `sessions/` talks to. It owns the whole
 * "place a `TASK` and persist its `scheduledStartTime`" flow — heuristic pass,
 * the 50/50 A/B policy assignment, the optional LinUCB override, and the
 * `SlotProposal` record — so `SessionsService` never touches `assignPolicy`
 * or `recordProposal` directly. Nothing else on the calendar is ever moved.
 *
 * The A/B override runs per single `TASK` and per series member
 * (`docs/scheduler/ab-testing.md`); a bandit failure always falls back to the
 * heuristic placement and never throws.
 */
@Injectable()
export class TaskPlacementService {
  private readonly logger = new Logger(TaskPlacementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly coordinator: SchedulingExperimentCoordinator,
    private readonly heuristic: HeuristicPlacer,
    private readonly bandit: BanditPlacer,
    private readonly seriesPlacer: SeriesPlacer,
    private readonly displacement: DisplacementService,
    private readonly python: PythonPlacer,
    private readonly config: ConfigService,
  ) {}

  /** `SCHEDULER_PLACEMENT_MODE` (default `legacy`), read per call. */
  private get mode(): PlacementMode {
    return parsePlacementMode(
      this.config.get<string>("SCHEDULER_PLACEMENT_MODE"),
    );
  }

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

  /**
   * heuristic place → persist → assignPolicy 50/50 → (LINUCB) bandit place →
   * persist + `recordProposal`. Best-effort: any A/B failure leaves the
   * heuristic placement standing.
   */
  private placeSingle(
    user: User,
    task: PlaceableTask,
    trigger: Trigger,
    now: Date,
    policy?: InfeasiblePolicy,
  ): Promise<PlacementResult> {
    return withSpan(
      "scheduler.placeSingle",
      (span) => this.placeSingleInner(span, user, task, trigger, now, policy),
      { "scheduling.trigger": trigger, "session.id": task.id },
    );
  }

  private async placeSingleInner(
    span: Span,
    user: User,
    task: PlaceableTask,
    trigger: Trigger,
    now: Date,
    policy?: InfeasiblePolicy,
  ): Promise<PlacementResult> {
    if (this.mode === "python") {
      return this.python.placeSingle(user, task, trigger, now, policy);
    }
    const heuristicStart = await this.computeHeuristicStart(user, task, now);
    await this.applyStart(task.id, heuristicStart);

    const outcome = await this.runExperimentSafely(
      user,
      task,
      trigger,
      now,
      heuristicStart,
    );
    await this.applyWinningSlotIfDifferent(task.id, heuristicStart, outcome);

    // Nothing free before the deadline: repack flexible tasks (issue #62 B),
    // then honour the user's accept-conflicts / accept-late choice.
    let displaced: AppliedMove[] = [];
    let fallbackStart: Date | null = null;
    if (!(outcome?.appliedStart ?? heuristicStart)) {
      const resolved = await this.resolveInfeasible(user, task, now, policy);
      displaced = resolved.displaced;
      fallbackStart = resolved.start;
      await this.applyStart(task.id, fallbackStart);
    }

    this.logPlacement(trigger, task.id, heuristicStart, outcome);
    this.emitPlacementTelemetry(span, trigger, heuristicStart, outcome);
    if (this.mode === "shadow") {
      // Fire-and-forget: never adds latency or fails the legacy placement.
      void this.python
        .shadowCompareSingle({
          user,
          task,
          now,
          legacyHeuristicStart: heuristicStart,
          legacyLinucbStart: outcome?.banditPick?.scheduledStartTime ?? null,
        })
        .catch((err: Error) =>
          this.logger.warn(`shadow compare failed: ${err.message}`),
        );
    }

    const start = outcome?.appliedStart ?? heuristicStart ?? fallbackStart;
    return {
      scheduledStartTime: start,
      appliedPolicy: outcome?.appliedPolicy ?? (start ? "HEURISTIC" : "NONE"),
      slotProposalId: outcome?.slotProposalId ?? null,
      alternativeSlot: outcome?.alternativeSlot ?? null,
      divergent: outcome?.divergent ?? false,
      displaced: displaced.length ? displaced : undefined,
    };
  }

  /**
   * B: plan an EDF repack of flexible tasks; on success persist the moves
   * (`SYSTEM_MOVE`, reward 0). Otherwise fall back to the user's chosen
   * policy; with none, the task stays unplaced (the pre-flight
   * {@link preflightTask} rejects that case before anything is written).
   */
  private async resolveInfeasible(
    user: User,
    task: PlaceableTask,
    now: Date,
    policy?: InfeasiblePolicy,
  ): Promise<{ start: Date | null; displaced: AppliedMove[] }> {
    try {
      const plan = await this.displacement.plan(user, task, now);
      if (plan.kind === "placed") {
        const durations = await this.durationsOf(plan.moves.map((m) => m.id));
        const displaced = await this.displacement.applyMoves(
          user.id,
          plan.moves,
          (id) => durations.get(id) ?? 15,
        );
        return { start: new Date(plan.startMs), displaced };
      }
      if (policy) {
        return {
          start: await this.displacement.fallbackStart(user, task, now, policy),
          displaced: [],
        };
      }
    } catch (err) {
      this.logger.warn(
        `displacement failed for session ${task.id}: ${(err as Error).message}`,
      );
    }
    return { start: null, displaced: [] };
  }

  private async durationsOf(ids: string[]): Promise<Map<string, number>> {
    const rows = await this.prisma.session.findMany({
      where: { id: { in: ids } },
      select: { id: true, durationMinutes: true },
    });
    return new Map(rows.map((r) => [r.id, r.durationMinutes]));
  }

  /**
   * Read-only guard for a single `TASK` create / deadline edit, run BEFORE
   * anything is written: rejects a deadline too close for the duration (400),
   * and — when no slot exists even after repacking flexible tasks — throws the
   * 409 {@link ScheduleInfeasibleException} unless the request already carries
   * an `infeasiblePolicy`. `taskId` (edit path) excludes the task itself.
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
    if (this.mode === "python") {
      await this.python.preflightSingle({
        user,
        taskId: args.taskId,
        durationMinutes,
        deadline,
        now,
        policy: args.policy,
      });
      return;
    }
    const id = args.taskId ?? PREFLIGHT_TASK_ID;
    const task: PlaceableTask = { id, durationMinutes, deadline };
    const start = await this.heuristic.placeTask(
      user.id,
      task,
      user.timezone,
      user.preferenceMatrix,
      now,
    );
    if (start) return;
    const plan = await this.displacement.plan(user, task, now);
    if (plan.kind === "placed" || args.policy) return;
    throw new ScheduleInfeasibleException();
  }

  private computeHeuristicStart(
    user: User,
    task: PlaceableTask,
    now: Date,
  ): Promise<Date | null> {
    return this.heuristic.placeTask(
      user.id,
      task,
      user.timezone,
      user.preferenceMatrix,
      now,
    );
  }

  private async applyStart(taskId: string, start: Date | null): Promise<void> {
    if (!start) return;
    await this.prisma.session.update({
      where: { id: taskId },
      data: { scheduledStartTime: start },
    });
  }

  /** The coordinator may have applied a different (LinUCB) start than the
   * heuristic pass already persisted — write it if so. */
  private async applyWinningSlotIfDifferent(
    taskId: string,
    heuristicStart: Date | null,
    outcome: ExperimentPlacementOutcome | null,
  ): Promise<void> {
    if (!outcome?.appliedStart) return;
    if (outcome.appliedStart.getTime() === heuristicStart?.getTime()) return;
    await this.applyStart(taskId, outcome.appliedStart);
  }

  /** The A/B assignment + optional bandit run — best-effort, the heuristic
   * placement above always stands if this fails. */
  private async runExperimentSafely(
    user: User,
    task: PlaceableTask,
    trigger: Trigger,
    now: Date,
    heuristicStart: Date | null,
  ): Promise<ExperimentPlacementOutcome | null> {
    try {
      const outcome = await this.coordinator.run({
        userId: user.id,
        sessionId: task.id,
        trigger,
        heuristicStart,
        runBandit: () =>
          this.bandit.placeTask(
            user.id,
            task,
            user.timezone,
            user.preferenceMatrix,
            now,
          ),
      });
      if (outcome.banditAttempted && !outcome.banditPick) {
        // LinUCB was attempted (primary or pairwise-sampled) but produced
        // nothing — the heuristic placement stands. `no_pick` covers URL
        // unset / timeout / non-2xx / no surviving slot (BanditPlacer
        // collapses them all to `null`).
        schedulerBanditFallback.add(1, { reason: "no_pick", trigger });
      }
      return outcome;
    } catch (err) {
      schedulerBanditFallback.add(1, { reason: "exception", trigger });
      this.logger.warn(
        `scheduling experiment (${trigger}) failed for session ${task.id}: ${
          (err as Error).message
        }`,
      );
      return null;
    }
  }

  private logPlacement(
    trigger: Trigger,
    taskId: string,
    heuristicStart: Date | null,
    outcome: ExperimentPlacementOutcome | null,
  ): void {
    const pick =
      outcome?.appliedPolicy === "LINUCB" ? outcome.banditPick : null;
    this.logger.log(
      `schedule[${trigger}] session=${taskId} assignedPolicy=${outcome?.assignedPolicy ?? "NONE"} ` +
        `applied=${outcome?.appliedPolicy ?? (heuristicStart ? "HEURISTIC" : "NONE")} ` +
        `heuristicProposal=${heuristicStart?.toISOString() ?? "none"} ` +
        `linucbProposal=${
          pick
            ? `${pick.scheduledStartTime.toISOString()} (arm=${pick.selectedArm})`
            : outcome?.assignedPolicy === SchedulingModel.LINUCB
              ? "none"
              : "n/a (not primary)"
        }`,
    );
  }

  private emitPlacementTelemetry(
    span: Span,
    trigger: Trigger,
    heuristicStart: Date | null,
    outcome: ExperimentPlacementOutcome | null,
  ): void {
    const assignedPolicy = outcome?.assignedPolicy ?? "NONE";
    const appliedPolicy =
      outcome?.appliedPolicy ?? (heuristicStart ? "HEURISTIC" : "NONE");
    schedulerAppliedPolicy.add(1, {
      assigned: assignedPolicy,
      applied: appliedPolicy,
      trigger,
    });
    span.setAttributes({
      "scheduling.assigned_policy": assignedPolicy,
      "scheduling.applied_policy": appliedPolicy,
    });
  }

  /**
   * Place every member of a freshly-created `TASK` series and persist the
   * placed `scheduledStartTime`s in one transaction. The caller has already
   * inserted the rows + `CREATE` events. Returns one row per member
   * (`null` start = nothing free fit).
   */
  /**
   * Read-only pre-flight feasibility check for a single `TASK` create — `true`
   * iff at least one empty slot fits `durationMinutes` somewhere in
   * `now … deadline`. Runs the same {@link HeuristicPlacer.placeTask} scan a
   * real create would, but against a placeholder id (no `Session` row exists
   * yet) — no DB write, no telemetry. `SessionCrudService.create` calls this
   * BEFORE inserting anything, so an infeasible create never persists an
   * unplaced task (no rollback needed).
   */
  async canPlaceTask(args: {
    user: User;
    durationMinutes: number;
    deadline: Date;
    now: Date;
  }): Promise<boolean> {
    if (this.mode === "python") {
      try {
        await this.python.preflightSingle(args);
        return true;
      } catch (err) {
        if (err instanceof ScheduleInfeasibleException) return false;
        throw err;
      }
    }
    const start = await this.heuristic.placeTask(
      args.user.id,
      {
        id: PREFLIGHT_TASK_ID,
        durationMinutes: args.durationMinutes,
        deadline: args.deadline,
      },
      args.user.timezone,
      args.user.preferenceMatrix,
      args.now,
    );
    return start !== null;
  }

  /**
   * Read-only pre-flight feasibility check for a `TASK` series create —
   * `true` iff EVERY member (`sessionCount` sittings of `durationMinutes`)
   * can be placed somewhere in `now … deadline` under the real placement
   * constraints (per-day cap, sibling spacing — {@link SeriesPlacer.placeSeries}
   * with `dryRun: true`). One infeasible member fails the whole check, so
   * `SessionCrudService.create` can reject the batch before any row exists —
   * no partially-placed series is ever persisted.
   */
  async canPlaceSeries(args: {
    user: User;
    durationMinutes: number;
    sessionCount: number;
    deadline: Date;
    now: Date;
  }): Promise<boolean> {
    if (this.mode === "python") return this.python.canPlaceSeries(args);
    const members: SeriesMemberInput[] = Array.from(
      { length: args.sessionCount },
      (_, i) => ({
        id: `${PREFLIGHT_TASK_ID}-${i}`,
        durationMinutes: args.durationMinutes,
      }),
    );
    const placements = await this.seriesPlacer.placeSeries(
      args.user.id,
      { members, deadline: args.deadline },
      args.user.timezone,
      args.user.preferenceMatrix,
      args.now,
      { trigger: "create", dryRun: true },
    );
    return placements.every((p) => p.scheduledStartTime !== null);
  }

  async placeSeriesOnCreate(args: {
    user: User;
    seriesId: string;
    members: SeriesMemberInput[];
    deadline: Date;
    now: Date;
  }): Promise<SeriesPlacementRow[]> {
    const { user, seriesId, members, deadline, now } = args;

    const placements =
      this.mode === "python"
        ? await this.python.placeSeries({
            user,
            members,
            deadline,
            now,
            trigger: "create",
          })
        : await this.seriesPlacer.placeSeries(
            user.id,
            { members, deadline },
            user.timezone,
            user.preferenceMatrix,
            now,
            { trigger: "create" },
          );

    const placed = placements.filter((p) => p.scheduledStartTime).length;
    this.logger.log(
      `schedule[create-series] series=${seriesId} members=${members.length} placed=${placed}/${members.length}`,
    );

    await this.persistPlaced(placements);
    return placements;
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
    const placements =
      this.mode === "python"
        ? await this.python.placeSeries({
            user,
            members: upcomingMembers,
            deadline: newDeadline,
            now,
            trigger: "deadline-change",
            fixedOccupied,
          })
        : await this.seriesPlacer.placeSeries(
            user.id,
            {
              members: upcomingMembers,
              deadline: newDeadline,
              fixedOccupied,
            },
            user.timezone,
            user.preferenceMatrix,
            now,
            { trigger: "deadline-change" },
          );
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
}
