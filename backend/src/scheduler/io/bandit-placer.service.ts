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
      this.fetchBanditPredictions(userId, days),
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

    // One range read for every scanned day (issue #62 C), then pure bucketing.
    const loads = await loadDayLoads(this.prisma, {
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

  /** One `/predict` HTTP call scoring every candidate day's arms. `null` on
   * any bandit failure — the caller falls back to the heuristic. */
  private async fetchBanditPredictions(
    userId: string,
    days: CandidateDay[],
  ): Promise<Record<string, Record<SchedulingArm, number>> | null> {
    const loaded = await this.armStates.loadAll(userId);
    const wireState = {} as Record<SchedulingArm, BanditArmStateWire>;
    for (const arm of SCHEDULING_ARMS) {
      wireState[arm] = { A: loaded[arm].A, b: loaded[arm].b };
    }
    return this.bandit.predict(
      days.map((d) => ({ day: d.dayStr, x: d.vector })),
      wireState,
    );
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
