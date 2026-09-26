import { Injectable, Logger, Optional } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import type {
  InfeasiblePolicy,
  PlacedMember,
  PlacementMember,
  PlacementPolicy,
} from "@zenflow/shared";
import {
  PlacementSource,
  SchedulingModel,
  type User,
} from "../../../generated/prisma";
import {
  ExperimentService,
  type PolicyAssignment,
} from "../../experiments/experiment.service";
import type { ExperimentTrigger } from "../../experiments/experiment.types";
import {
  schedulerAppliedPolicy,
  schedulerPlacementSource,
} from "../../observability/metrics";
import { recordPhase } from "../../observability/phase-timings";
import { PrismaService } from "../../prisma/prisma.service";
import {
  MAX_SCAN_DAYS,
  MAX_SERIES_ALTERNATIVES,
  SCAN_CAP_DAYS,
} from "../constants";
import {
  ceilToSlot,
  DAY_MS,
  lastResortStart,
  MS_PER_MINUTE,
  type Interval,
} from "../core/slot";
import { ScheduleInfeasibleException } from "../schedule-infeasible.exception";
import type {
  PlaceableTask,
  PlacementResult,
  SeriesMemberInput,
  SeriesPlacementRow,
} from "../types/placement.types";
import { DisplacementService, type AppliedMove } from "./displacement.service";
import { FallbackPlacer } from "./fallback-placer.service";
import { PlacementGateway } from "./placement-gateway.service";
import { selectSeriesAlternatives } from "./series-alternatives";
import type { DegradedReason } from "./placement-mode";

/** Placeholder id for a pre-flight scan: no `Session` row exists yet. */
const PREFLIGHT_TASK_ID = "__preflight__";

type Trigger = ExperimentTrigger;

const placed = (o: PlacedMember["outcome"]): boolean =>
  o === "PLACED" ||
  o === "DISPLACED" ||
  o === "ACCEPTED_CONFLICTS" ||
  o === "ACCEPTED_LATE" ||
  o === "ACCEPTED_LAST_RESORT";

/**
 * `python` placement mode (ADR-0003 phase 4): gather -> `POST /v1/place` ->
 * apply -> persist. The A/B policy roll (`ExperimentService.assignPolicy`, the
 * only RNG) and every write stay here; all ranking is Python's. When the
 * service is unavailable the request is answered by the frozen heuristic
 * ({@link FallbackPlacer}): no displacement, then the best free slot up to
 * 30 days late (never 503).
 *
 * A placement runs after its `Session` row exists, so it never leaves a `TASK`
 * unplaced: when nothing real fits, the task gets the last resort (Python's
 * `ACCEPTED_LAST_RESORT`, or {@link lastResortStart} when Python is
 * unavailable or answered without a start) and the result carries
 * `lastResort: true`. Only the read-only pre-flights report a miss.
 */
@Injectable()
export class PythonPlacer {
  private readonly logger = new Logger(PythonPlacer.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: PlacementGateway,
    private readonly fallback: FallbackPlacer,
    private readonly experiment: ExperimentService,
    private readonly displacement: DisplacementService,
    @Optional() private readonly cls?: ClsService,
  ) {}

  // ---- pre-flights (read-only, run BEFORE anything is written) ----------

  /** Single `TASK` pre-flight: 409 when infeasible w/o policy (Python or fallback). */
  async preflightSingle(args: {
    user: User;
    taskId?: string;
    durationMinutes: number;
    deadline: Date;
    now: Date;
    policy?: InfeasiblePolicy;
  }): Promise<void> {
    const { user, deadline, now, policy } = args;
    const task: PlaceableTask = {
      id: args.taskId ?? PREFLIGHT_TASK_ID,
      durationMinutes: args.durationMinutes,
      deadline,
    };
    const req = await this.gateway.buildRequest({
      user,
      members: [this.memberOf(task, "HEURISTIC", false)],
      deadline,
      now,
      mode: "PREFLIGHT",
      maxScanDays: SCAN_CAP_DAYS,
      excludeSessionIds: args.taskId ? [args.taskId] : [],
    });
    const res = await this.gateway.placeSingleTwoPhase(req, user, task, policy);
    if (!res.ok) {
      this.noteFallback(res.reason);
      const start = await this.fallback.placeSingle(
        user.id,
        task,
        user.timezone,
        user.preferenceMatrix,
        now,
      );
      if (start || policy) return;
      throw new ScheduleInfeasibleException();
    }
    this.noteSource("python");
    if (placed(res.response.results[0].outcome) || policy) return;
    throw new ScheduleInfeasibleException();
  }

  /** `true` iff every member of a would-be series fits (Python or fallback). */
  async canPlaceSeries(args: {
    user: User;
    durationMinutes: number;
    sessionCount: number;
    deadline: Date;
    now: Date;
  }): Promise<boolean> {
    const { user, deadline, now } = args;
    const members: SeriesMemberInput[] = Array.from(
      { length: args.sessionCount },
      (_, i) => ({
        id: `${PREFLIGHT_TASK_ID}-${i}`,
        durationMinutes: args.durationMinutes,
      }),
    );
    const req = await this.gateway.buildRequest({
      user,
      members: members.map((m) => this.memberOf(m, "HEURISTIC", false)),
      deadline,
      now,
      mode: "PREFLIGHT",
      maxScanDays: MAX_SCAN_DAYS,
      excludeSessionIds: [],
    });
    const res = await this.gateway.place(req);
    if (res.ok) {
      this.noteSource("python");
      return res.response.results.every((r) => r.outcome === "PLACED");
    }
    this.noteFallback(res.reason);
    const rows = await this.fallback.placeSeries(
      user.id,
      { members, deadline },
      user.timezone,
      user.preferenceMatrix,
      now,
    );
    return rows.every((r) => r.scheduledStartTime !== null);
  }

  // ---- single TASK -------------------------------------------------------

  /**
   * `allowLastResort: false` (conflict "reschedule them all") answers a miss
   * with a `null` start and writes nothing, so a task that already has a
   * start keeps it instead of being moved onto another conflict.
   */
  async placeSingle(
    user: User,
    task: PlaceableTask,
    trigger: Trigger,
    now: Date,
    policy?: InfeasiblePolicy,
    allowLastResort = true,
  ): Promise<PlacementResult> {
    const assignment = this.experiment.assignPolicy();
    const member = this.memberOf(
      task,
      assignment.primaryPolicy,
      assignment.pairwiseShown ||
        assignment.primaryPolicy === SchedulingModel.LINUCB,
    );
    const req = await this.gateway.buildRequest({
      user,
      members: [member],
      deadline: task.deadline,
      now,
      mode: "PLACE",
      maxScanDays: SCAN_CAP_DAYS,
      excludeSessionIds: [task.id],
    });
    const res = await this.gateway.placeSingleTwoPhase(req, user, task, policy);
    if (!res.ok) {
      return this.placeSingleDegraded(
        user,
        task,
        trigger,
        now,
        assignment,
        res.reason,
        policy,
        allowLastResort,
      );
    }
    this.noteSource("python");

    const r = res.response.results[0];
    let lastResort = r.outcome === "ACCEPTED_LAST_RESORT";
    let start =
      placed(r.outcome) &&
      r.startMs !== null &&
      (allowLastResort || !lastResort)
        ? r.startMs
        : null;
    if (start === null && allowLastResort) {
      // Python should have answered ACCEPTED_LAST_RESORT; never leave the row
      // unplaced regardless.
      start = lastResortStart(
        task.durationMinutes,
        now.getTime(),
        task.deadline.getTime(),
      );
      lastResort = true;
      this.logger.error(
        `schedule[${trigger}] session=${task.id} python outcome=${r.outcome} had no start; pinned to last resort`,
      );
    }
    lastResort = lastResort && start !== null;
    const tApply = Date.now();
    const displaced: AppliedMove[] = r.moves.length
      ? await this.applyMoves(user.id, r.moves)
      : [];
    if (start !== null) {
      await this.prisma.session.update({
        where: { id: task.id },
        data: { scheduledStartTime: new Date(start) },
      });
    }

    const heuristicMs = r.heuristic?.startMs ?? null;
    const linucb = r.linucb;
    const effectivePairwise = assignment.pairwiseShown && linucb !== null;
    const rawAlternative =
      assignment.primaryPolicy === SchedulingModel.LINUCB
        ? heuristicMs
        : (linucb?.startMs ?? null);
    const divergent =
      effectivePairwise &&
      rawAlternative !== null &&
      start !== null &&
      rawAlternative !== start;

    const slotProposalId = await this.experiment.recordProposal({
      userId: user.id,
      sessionId: task.id,
      trigger,
      primaryPolicy: assignment.primaryPolicy,
      randomizationSeed: assignment.randomizationSeed,
      heuristicProposal: {
        scheduledStartTime:
          heuristicMs !== null ? new Date(heuristicMs).toISOString() : null,
      },
      proposedStartTime: start !== null ? new Date(start) : null,
      modelProposal: linucb
        ? {
            scheduledStartTime: new Date(linucb.startMs),
            selectedArm: linucb.selectedArm,
          }
        : null,
      featureVector: linucb?.featureVector ?? [],
      selectedArm: linucb?.selectedArm ?? null,
      weights: linucb?.weights ?? null,
      pairwiseShown: effectivePairwise,
      pairwisePositions: effectivePairwise
        ? { primaryPosition: Math.random() < 0.5 ? "first" : "second" }
        : null,
      placementSource: PlacementSource.PYTHON,
      degradedReason: null,
      modelVersion: res.response.paramsVersion,
    });
    recordPhase(this.cls, "db_apply", Date.now() - tApply);

    const appliedPolicy = start !== null ? r.appliedPolicy : "NONE";
    schedulerAppliedPolicy.add(1, {
      assigned: assignment.primaryPolicy,
      applied: appliedPolicy,
      trigger,
    });
    this.logger.log(
      `schedule[${trigger}] source=python session=${task.id} outcome=${r.outcome} ` +
        `assigned=${assignment.primaryPolicy} applied=${appliedPolicy} start=${
          start !== null ? new Date(start).toISOString() : "none"
        } moves=${r.moves.length} paramsVersion=${res.response.paramsVersion}`,
    );

    return {
      scheduledStartTime: start !== null ? new Date(start) : null,
      appliedPolicy: appliedPolicy === "NONE" ? "NONE" : appliedPolicy,
      slotProposalId,
      alternativeSlot:
        divergent && rawAlternative !== null ? new Date(rawAlternative) : null,
      divergent,
      displaced: displaced.length ? displaced : undefined,
      ...(lastResort ? { lastResort: true } : {}),
    };
  }

  /** Frozen-heuristic single placement (ADR-0003 2.4). */
  private async placeSingleDegraded(
    user: User,
    task: PlaceableTask,
    trigger: Trigger,
    now: Date,
    assignment: PolicyAssignment,
    reason: DegradedReason,
    policy: InfeasiblePolicy | undefined,
    allowLastResort: boolean,
  ): Promise<PlacementResult> {
    this.noteFallback(reason);
    let start = await this.fallback.placeSingle(
      user.id,
      task,
      user.timezone,
      user.preferenceMatrix,
      now,
    );
    // Infeasible accepted (or the row must not stay unplaced): best free slot
    // up to 30 days late.
    if (!start && (policy || allowLastResort)) {
      start = await this.fallback.placeSingle(
        user.id,
        { ...task, deadline: new Date(task.deadline.getTime() + 30 * DAY_MS) },
        user.timezone,
        user.preferenceMatrix,
        now,
      );
    }
    // Last resort: pinned by the deadline, overlap accepted (no TS ranking).
    let lastResort = false;
    if (!start && allowLastResort) {
      start = new Date(
        lastResortStart(
          task.durationMinutes,
          now.getTime(),
          task.deadline.getTime(),
        ),
      );
      lastResort = true;
    }
    if (!start) {
      // Only when the caller opted out of the last resort: nothing written.
      this.logger.warn(
        `schedule[${trigger}] source=ts_fallback reason=${reason} session=${task.id} start=none`,
      );
      return {
        scheduledStartTime: null,
        appliedPolicy: "NONE",
        slotProposalId: null,
        alternativeSlot: null,
        divergent: false,
        degraded: true,
      };
    }
    await this.prisma.session.update({
      where: { id: task.id },
      data: { scheduledStartTime: start },
    });
    const slotProposalId = await this.recordFallbackProposal(
      user.id,
      task.id,
      trigger,
      assignment,
      start,
      reason,
    );
    this.logger.warn(
      `schedule[${trigger}] source=ts_fallback reason=${reason} session=${task.id} start=${start.toISOString()}${
        lastResort ? " lastResort" : ""
      }`,
    );
    return {
      scheduledStartTime: start,
      appliedPolicy: "HEURISTIC",
      slotProposalId,
      alternativeSlot: null,
      divergent: false,
      degraded: true,
      ...(lastResort ? { lastResort: true } : {}),
    };
  }

  // ---- series ------------------------------------------------------------

  /**
   * Place every member of a `TASK` series in one call. Returns one row per
   * member, never with a `null` start: a member with no real slot gets the
   * last resort (`lastResort: true`). Persisting the starts is the caller's
   * job. Degraded => frozen loop, then the same last resort.
   *
   * The A/B roll is series-level (#58): ONE `assignPolicy()`, so every member
   * shares its `primaryPolicy` and `randomizationSeed`, and the whole series
   * is applied from one plan. On a pairwise-sampled series Python computes a
   * second full plan with the other policy; the soonest (≤
   * {@link MAX_SERIES_ALTERNATIVES}) sittings whose other-plan pick differs
   * and doesn't clash with a sibling are surfaced (`divergent`,
   * `alternativeSlot`, `pairwiseShown`). Still one `SlotProposal` per member.
   * `surfaceAlternatives: false` (a caller that never shows the rows) records
   * every member with `pairwiseShown = false`.
   */
  async placeSeries(args: {
    user: User;
    members: SeriesMemberInput[];
    deadline: Date;
    now: Date;
    trigger: Trigger;
    fixedOccupied?: Interval[];
    surfaceAlternatives?: boolean;
  }): Promise<SeriesPlacementRow[]> {
    const { user, members, deadline, now, trigger } = args;
    const fixedOccupied = args.fixedOccupied ?? [];
    if (
      members.length === 0 ||
      ceilToSlot(now.getTime()) >= deadline.getTime()
    ) {
      return this.pinUnplaced(
        members.map((m) => ({ id: m.id, scheduledStartTime: null })),
        members,
        deadline,
        now,
        fixedOccupied,
      );
    }
    const assignment = this.experiment.assignPolicy();
    // A LinUCB primary runs LinUCB regardless of `computeBoth` (Python's
    // PolicySelector); `computeBoth` only asks for the second full plan.
    const defs: PlacementMember[] = members.map((m) =>
      this.memberOf(m, assignment.primaryPolicy, assignment.pairwiseShown),
    );
    const req = await this.gateway.buildRequest({
      user,
      members: defs,
      deadline,
      now,
      mode: "PLACE",
      maxScanDays: MAX_SCAN_DAYS,
      excludeSessionIds: members.map((m) => m.id),
      fixedOccupied,
    });
    const res = await this.gateway.place(req);

    if (!res.ok) {
      this.noteFallback(res.reason);
      const rows = await this.fallback.placeSeries(
        user.id,
        { members, deadline, fixedOccupied },
        user.timezone,
        user.preferenceMatrix,
        now,
      );
      // Degraded: one plan only, never any alternatives.
      const ids = await Promise.all(
        rows.map((row) =>
          row.scheduledStartTime
            ? this.recordFallbackProposal(
                user.id,
                row.id,
                trigger,
                assignment,
                row.scheduledStartTime,
                res.reason,
              )
            : Promise.resolve(null),
        ),
      );
      return this.pinUnplaced(
        rows.map((r, i) => ({
          ...r,
          degraded: true,
          slotProposalId: ids[i],
          alternativeSlot: null,
          divergent: false,
        })),
        members,
        deadline,
        now,
        fixedOccupied,
      );
    }

    this.noteSource("python");
    const results = res.response.results;
    const rawStarts = members.map((_, i) => {
      const r = results[i];
      const lastResort = r.outcome === "ACCEPTED_LAST_RESORT";
      return r.outcome === "PLACED" || lastResort ? r.startMs : null;
    });
    const rows = this.pinUnplaced(
      members.map((m, i) => ({
        id: m.id,
        scheduledStartTime:
          rawStarts[i] !== null ? new Date(rawStarts[i]) : null,
        ...(results[i].outcome === "ACCEPTED_LAST_RESORT" &&
        rawStarts[i] !== null
          ? { lastResort: true }
          : {}),
      })),
      members,
      deadline,
      now,
      fixedOccupied,
    );

    // The other plan's pick: only when both plans placed the sitting and the
    // applied outcome is a real slot (never the last resort).
    const otherStarts = members.map((_, i) => {
      const r = results[i];
      if (r.outcome !== "PLACED" || !r.heuristic || !r.linucb) return null;
      return assignment.primaryPolicy === SchedulingModel.LINUCB
        ? r.heuristic.startMs
        : r.linucb.startMs;
    });
    const shown = new Set(
      assignment.pairwiseShown && args.surfaceAlternatives !== false
        ? selectSeriesAlternatives(
            members.map((m, i) => ({
              durationMinutes: m.durationMinutes,
              appliedStartMs: (rows[i].scheduledStartTime as Date).getTime(),
              otherStartMs: otherStarts[i],
            })),
            fixedOccupied,
            MAX_SERIES_ALTERNATIVES,
          )
        : [],
    );

    const out: SeriesPlacementRow[] = [];
    for (let i = 0; i < members.length; i++) {
      const r = results[i];
      const start = rawStarts[i];
      const linucb = r.linucb;
      const isShown = shown.has(i);
      const slotProposalId = await this.experiment.recordProposal({
        userId: user.id,
        sessionId: members[i].id,
        trigger,
        primaryPolicy: assignment.primaryPolicy,
        randomizationSeed: assignment.randomizationSeed,
        heuristicProposal: {
          scheduledStartTime: r.heuristic
            ? new Date(r.heuristic.startMs).toISOString()
            : null,
        },
        proposedStartTime: start !== null ? new Date(start) : null,
        modelProposal: linucb
          ? {
              scheduledStartTime: new Date(linucb.startMs),
              selectedArm: linucb.selectedArm,
            }
          : null,
        featureVector: linucb?.featureVector ?? [],
        selectedArm: linucb?.selectedArm ?? null,
        weights: linucb?.weights ?? null,
        pairwiseShown: isShown,
        pairwisePositions: isShown
          ? { primaryPosition: Math.random() < 0.5 ? "first" : "second" }
          : null,
        placementSource: PlacementSource.PYTHON,
        degradedReason: null,
        modelVersion: res.response.paramsVersion,
      });
      const other = otherStarts[i];
      out.push({
        ...rows[i],
        slotProposalId,
        alternativeSlot: isShown && other !== null ? new Date(other) : null,
        divergent: isShown,
      });
    }
    return out;
  }

  // ---- helpers -----------------------------------------------------------

  /**
   * Give every still-unplaced series row the last resort, back-to-back so
   * pinned sittings never stack on each other or on placed siblings.
   */
  private pinUnplaced(
    rows: SeriesPlacementRow[],
    members: SeriesMemberInput[],
    deadline: Date,
    now: Date,
    fixedOccupied: Interval[],
  ): SeriesPlacementRow[] {
    const avoid: Interval[] = [...fixedOccupied];
    rows.forEach((row, i) => {
      if (!row.scheduledStartTime) return;
      const start = row.scheduledStartTime.getTime();
      avoid.push({
        start,
        end: start + members[i].durationMinutes * MS_PER_MINUTE,
      });
    });
    return rows.map((row, i) => {
      if (row.scheduledStartTime) return row;
      const dur = members[i].durationMinutes;
      const start = lastResortStart(
        dur,
        now.getTime(),
        deadline.getTime(),
        avoid,
      );
      avoid.push({ start, end: start + dur * MS_PER_MINUTE });
      return { ...row, scheduledStartTime: new Date(start), lastResort: true };
    });
  }

  /**
   * Single `TASK`: `computeBoth` is true whenever LinUCB is primary or the
   * event was pairwise-sampled, so the heuristic pick is always recorded as
   * `SlotProposal.heuristicProposal` exactly like the legacy path did. A
   * series sets it only when pairwise-sampled — on a series it asks Python
   * for a second full plan (#58); a LinUCB primary still runs LinUCB either
   * way (Python `PolicySelector`), falling back to the heuristic per member.
   */
  private memberOf(
    task: { id: string; durationMinutes: number; prevStartMs?: number },
    primaryPolicy: PlacementPolicy,
    computeBoth: boolean,
  ): PlacementMember {
    return {
      id: task.id,
      durationMinutes: task.durationMinutes,
      ...(task.prevStartMs !== undefined
        ? { prevStartMs: task.prevStartMs }
        : {}),
      primaryPolicy,
      computeBoth,
    };
  }

  private async applyMoves(
    userId: string,
    moves: { id: string; fromMs: number; toMs: number }[],
  ): Promise<AppliedMove[]> {
    const rows = await this.prisma.session.findMany({
      where: { id: { in: moves.map((m) => m.id) }, deleted: false },
      select: { id: true, durationMinutes: true },
    });
    const dur = new Map(rows.map((r) => [r.id, r.durationMinutes]));
    return this.displacement.applyMoves(
      userId,
      moves,
      (id) => dur.get(id) ?? 15,
    );
  }

  private recordFallbackProposal(
    userId: string,
    sessionId: string,
    trigger: Trigger,
    assignment: PolicyAssignment,
    start: Date,
    reason: DegradedReason,
  ): Promise<string | null> {
    return this.experiment.recordProposal({
      userId,
      sessionId,
      trigger,
      primaryPolicy: assignment.primaryPolicy,
      randomizationSeed: assignment.randomizationSeed,
      heuristicProposal: { scheduledStartTime: start.toISOString() },
      proposedStartTime: start,
      modelProposal: null,
      featureVector: [],
      selectedArm: null,
      weights: null,
      pairwiseShown: false,
      pairwisePositions: null,
      placementSource: PlacementSource.TS_FALLBACK,
      degradedReason: reason,
      modelVersion: null,
    });
  }

  private noteSource(source: "python"): void {
    schedulerPlacementSource.add(1, { source, reason: "none" });
  }

  private noteFallback(reason: DegradedReason): void {
    schedulerPlacementSource.add(1, { source: "ts_fallback", reason });
  }
}
