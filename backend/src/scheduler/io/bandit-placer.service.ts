import { Injectable } from "@nestjs/common";
import {
  SCHEDULING_ARMS,
  type BanditArmStateWire,
  type SchedulingArm,
} from "@zenflow/shared";
import { PrismaService } from "../../prisma/prisma.service";
import { BanditArmStateRepository } from "../../bandit/bandit-arm-state.repository";
import { BanditService } from "../../bandit/bandit.service";
import { MAX_SCAN_DAYS, SCAN_CAP_DAYS } from "../constants";
import { buildContextVector } from "../core/context-vector";
import { loadDayLoads } from "./day-load";
import { emptyWorkloadByType } from "../types/context-vector.types";
import type {
  BanditPick,
  CandidateDay,
  PlaceableTask,
  PlacementWindow,
} from "../types/placement.types";
import { loadObservationCount } from "./observation-count";
import { bestLinucbSlot, type BestLinucbSlot } from "../core/linucb-best-slot";
import {
  addDaysStr,
  ceilToSlot,
  DAY_MS,
  dayDiffStr,
  isoWeekday,
  localDateStr,
  MS_PER_MINUTE,
  SLOT_MS,
  type Interval,
} from "../core/slot";
import { minutesToUtc } from "../../common/utils";
import type { PlaceInWindowOpts } from "./heuristic-placer.service";

/**
 * Policy B — places one `TASK` with the Disjoint-LinUCB policy
 * (`docs/adr/0001-linucb-model-design.md` §8, `docs/scheduler/reranking.md`):
 * a per-candidate-day `/predict`, then a slot-first pick
 * (issue #62 A, `core/linucb-best-slot.ts`) — every feasible 15-min start on
 * every day is scored by the adaptive blend of the overlap-weighted arm score
 * and the preference matrix, plus stability, then ranked across days. A slot may run past local midnight up to the deadline (D5).
 *
 * Returns `null` on any reason to fall back to the heuristic — the bandit
 * service is unreachable/disabled, `/predict` failed, or no slot survives.
 */
@Injectable()
export class BanditPlacer {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bandit: BanditService,
    private readonly armStates: BanditArmStateRepository,
  ) {}

  /** Place one `TASK` anywhere in `[next_15min(now), deadline]`. */
  async placeTask(
    userId: string,
    task: PlaceableTask,
    timezone: string,
    preferenceMatrix: number[],
    now: Date,
  ): Promise<BanditPick | null> {
    if (!this.bandit.enabled) return null;

    const next15Ms = ceilToSlot(now.getTime());
    const deadlineMs = task.deadline.getTime();
    const durationMs = task.durationMinutes * MS_PER_MINUTE;
    if (next15Ms + durationMs > deadlineMs) return null;

    const window: PlacementWindow = {
      firstDayStr: localDateStr(new Date(next15Ms), timezone),
      lastDayStr: localDateStr(new Date(deadlineMs - 1), timezone),
    };
    return this.placeInWindow(
      userId,
      task,
      timezone,
      preferenceMatrix,
      now,
      window,
      { maxScanDays: SCAN_CAP_DAYS },
    );
  }

  /**
   * Place one `TASK` within a bounded local-day range (used by the series
   * placer, which clamps each member's window and vetoes full days). `window`
   * is already clamped; at most `opts.maxScanDays` days are scanned.
   */
  async placeInWindow(
    userId: string,
    task: PlaceableTask,
    timezone: string,
    preferenceMatrix: number[],
    now: Date,
    window: PlacementWindow,
    opts: PlaceInWindowOpts = {},
  ): Promise<BanditPick | null> {
    if (!this.bandit.enabled) return null;

    const next15Ms = ceilToSlot(now.getTime());
    const deadlineMs = task.deadline.getTime();
    const durationMs = task.durationMinutes * MS_PER_MINUTE;
    if (next15Ms + durationMs > deadlineMs) return null;

    // A slot may start as late as 23:45 and run its full length past local
    // midnight, bounded only by the deadline (D5) — the widest that post-
    // midnight overhang can be is `duration − one slot`.
    const overhangMs = durationMs - SLOT_MS;

    const days = await this.loadCandidateContext(
      userId,
      task,
      timezone,
      now,
      window,
      opts,
      overhangMs,
    );
    if (days.length === 0) return null;

    const [scores, observationCount] = await Promise.all([
      this.fetchBanditPredictions(
        userId,
        days.map((d) => ({ day: d.dayStr, x: d.vector })),
      ),
      loadObservationCount(this.prisma, userId),
    ]);
    if (!scores) return null;

    const best = this.pickBestSlot({
      days,
      scores,
      task,
      timezone,
      preferenceMatrix,
      next15Ms,
      deadlineMs,
      extraOccupied: opts.extraOccupied ?? [],
      observationCount,
    });
    if (!best) return null;

    return {
      scheduledStartTime: new Date(best.startMs),
      selectedArm: best.arm,
      featureVector: best.vector,
      weights: best.weights,
    };
  }

  /** The only Prisma I/O in this class: one batched range read for every
   * scanned day + a pure context-vector build per day. */
  private async loadCandidateContext(
    userId: string,
    task: PlaceableTask,
    timezone: string,
    now: Date,
    window: PlacementWindow,
    opts: PlaceInWindowOpts,
    overhangMs: number,
  ): Promise<CandidateDay[]> {
    const deadlineMs = task.deadline.getTime();
    const todayStr = localDateStr(now, timezone);

    const bounds: { dayStr: string; dayStartMs: number; dayEndMs: number }[] =
      [];
    for (
      let dayStr = window.firstDayStr;
      dayStr <= window.lastDayStr &&
      bounds.length < (opts.maxScanDays ?? MAX_SCAN_DAYS);
      dayStr = addDaysStr(dayStr, 1)
    ) {
      if (opts.skipDay?.(dayStr)) continue;
      bounds.push({
        dayStr,
        dayStartMs: minutesToUtc(dayStr, 0, timezone).getTime(),
        dayEndMs: minutesToUtc(addDaysStr(dayStr, 1), 0, timezone).getTime(),
      });
    }

    // One range read for every scanned day (issue #62 C), then pure bucketing
    // — unless the caller already fetched the union across every series
    // member's window (issue "batch series-member scoring"), in which case
    // we reuse that instead of reading again.
    const loads = opts.preloadedDayLoads
      ? bounds.map(
          (b) =>
            opts.preloadedDayLoads!.get(b.dayStr) ?? {
              occupied: [],
              workloadByType: emptyWorkloadByType(),
            },
        )
      : await loadDayLoads(this.prisma, {
          userId,
          days: bounds,
          timezone,
          excludeSessionIds: [task.id],
          // See the post-midnight blocks a straddling placement must clear (D5).
          occupiedLookaheadMs: overhangMs,
        });

    const days: CandidateDay[] = bounds.map((b, i) => {
      const { occupied, workloadByType } = loads[i];
      const vector = buildContextVector({
        remainingDaysUntilDeadline: Math.max(
          0,
          Math.floor((deadlineMs - now.getTime()) / DAY_MS),
        ),
        durationMinutes: task.durationMinutes,
        candidateIsoWeekday: isoWeekday(b.dayStr),
        candidateDaysFromNow: Math.max(0, dayDiffStr(todayStr, b.dayStr)),
        workloadByType,
        semesterPhase: null,
      });
      return { ...b, occupied, vector };
    });
    return days;
  }

  /** One `/predict` HTTP call scoring every given `{day, x}` context. `null`
   * on any bandit failure — the caller falls back to the heuristic. Shared
   * by both the single-task path (one member's own candidate days) and
   * {@link placeSeriesMembers} (every disjoint series member's candidate
   * days at once, `day` keys prefixed per-member to avoid collisions). */
  private async fetchBanditPredictions(
    userId: string,
    contexts: { day: string; x: number[] }[],
  ): Promise<Record<string, Record<SchedulingArm, number>> | null> {
    const loaded = await this.armStates.loadAll(userId);
    const wireState = {} as Record<SchedulingArm, BanditArmStateWire>;
    for (const arm of SCHEDULING_ARMS) {
      wireState[arm] = { A: loaded[arm].A, b: loaded[arm].b };
    }
    return this.bandit.predict(contexts, wireState);
  }

  /**
   * Tier 1 (issue "batch series-member scoring"): places every given
   * DISJOINT-window series member with ONE shared `/predict` round-trip
   * instead of one call per member. Callers must guarantee the members'
   * candidate-day windows never overlap (the same invariant
   * {@link seriesWindowsAreDisjoint} guards in `SeriesPlacer`) — this method
   * does not itself re-check that, it only guarantees no wire-key collision
   * regardless (each context is keyed `${task.id}::${dayStr}`).
   *
   * Builds every member's candidate-day context vectors (still one pure
   * pass per member, reusing `opts.preloadedDayLoads` when the caller
   * already fetched the day-load union), sends them all to
   * `services/bandit` together, then slices the scores back per member by
   * its own `${task.id}::${dayStr}` keys before running the same
   * {@link pickBestSlot} arm-then-minute search used by the single-task
   * path. A member with no feasible candidate day, or the whole batch on
   * any bandit failure, maps to `null` (falls back to the heuristic).
   */
  async placeSeriesMembers(
    userId: string,
    timezone: string,
    preferenceMatrix: number[],
    now: Date,
    members: {
      task: PlaceableTask;
      window: PlacementWindow;
      opts: PlaceInWindowOpts;
    }[],
  ): Promise<Map<string, BanditPick | null>> {
    const result = new Map<string, BanditPick | null>();
    if (!this.bandit.enabled) {
      for (const m of members) result.set(m.task.id, null);
      return result;
    }

    const next15Ms = ceilToSlot(now.getTime());
    const perMember: { task: PlaceableTask; days: CandidateDay[] }[] = [];
    for (const m of members) {
      const deadlineMs = m.task.deadline.getTime();
      const durationMs = m.task.durationMinutes * MS_PER_MINUTE;
      if (next15Ms + durationMs > deadlineMs) {
        perMember.push({ task: m.task, days: [] });
        continue;
      }
      const overhangMs = durationMs - SLOT_MS;
      const days = await this.loadCandidateContext(
        userId,
        m.task,
        timezone,
        now,
        m.window,
        m.opts,
        overhangMs,
      );
      perMember.push({ task: m.task, days });
    }

    const contexts: { day: string; x: number[] }[] = [];
    for (const { task, days } of perMember) {
      for (const d of days) {
        contexts.push({ day: `${task.id}::${d.dayStr}`, x: d.vector });
      }
    }
    if (contexts.length === 0) {
      for (const m of members) result.set(m.task.id, null);
      return result;
    }

    const [scores, observationCount] = await Promise.all([
      this.fetchBanditPredictions(userId, contexts),
      loadObservationCount(this.prisma, userId),
    ]);
    if (!scores) {
      for (const m of members) result.set(m.task.id, null);
      return result;
    }

    const optsByTaskId = new Map(members.map((m) => [m.task.id, m.opts]));
    for (const { task, days } of perMember) {
      if (days.length === 0) {
        result.set(task.id, null);
        continue;
      }
      const memberScores: Record<string, Record<SchedulingArm, number>> = {};
      for (const d of days) {
        const wire = scores[`${task.id}::${d.dayStr}`];
        if (wire) memberScores[d.dayStr] = wire;
      }
      const best = this.pickBestSlot({
        days,
        scores: memberScores,
        task,
        timezone,
        preferenceMatrix,
        next15Ms,
        deadlineMs: task.deadline.getTime(),
        extraOccupied: optsByTaskId.get(task.id)?.extraOccupied ?? [],
        observationCount,
      });
      result.set(
        task.id,
        best
          ? {
              scheduledStartTime: new Date(best.startMs),
              selectedArm: best.arm,
              featureVector: best.vector,
              weights: best.weights,
            }
          : null,
      );
    }

    return result;
  }

  /** Two-step arm-then-minute slot pick (Item 3B2) — pure math over the
   * already-loaded days/scores, no I/O. Delegates to the pure core scan
   * ({@link bestLinucbSlot}) shared with anything else that needs to
   * reproduce this exact "arm scores → concrete slot" search (e.g. the
   * offline simulator's TS bridge, `backend/scripts/simulation-bridge.ts`). */
  private pickBestSlot(args: {
    days: CandidateDay[];
    scores: Record<string, Record<SchedulingArm, number>>;
    task: PlaceableTask;
    timezone: string;
    preferenceMatrix: number[];
    next15Ms: number;
    deadlineMs: number;
    extraOccupied: Interval[];
    observationCount: number;
  }): BestLinucbSlot | null {
    const {
      days,
      scores,
      task,
      timezone,
      preferenceMatrix,
      next15Ms,
      deadlineMs,
      extraOccupied,
      observationCount,
    } = args;

    return bestLinucbSlot({
      days: days.map((day) => ({
        ...day,
        armScores: scores[day.dayStr] ?? {},
      })),
      durationMinutes: task.durationMinutes,
      timezone,
      prefMatrix: preferenceMatrix,
      nextMs: next15Ms,
      deadlineMs,
      extraOccupied,
      prevStartMs: task.prevStartMs,
      observationCount,
    });
  }
}
