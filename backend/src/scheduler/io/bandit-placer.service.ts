import { Injectable } from "@nestjs/common";
import {
  SCHEDULING_ARMS,
  type BanditArmStateWire,
  type SchedulingArm,
} from "@zenflow/shared";
import { PrismaService } from "../../prisma/prisma.service";
import { BanditArmStateRepository } from "../../bandit/bandit-arm-state.repository";
import { BanditService } from "../../bandit/bandit.service";
import { MAX_SCAN_DAYS } from "../constants";
import { buildContextVector } from "../core/context-vector";
import { loadDayLoad } from "./day-load";
import type {
  BanditPick,
  CandidateDay,
  PlaceableTask,
  PlacementWindow,
} from "../types/placement.types";
import { linucbSlotScore } from "../core/linucb-slot-score";
import {
  addDaysStr,
  ceilToSlot,
  DAY_MS,
  dayDiffStr,
  isoWeekday,
  localDateStr,
  MS_PER_MINUTE,
  overlapsAny,
  SLOT_MS,
  type Interval,
} from "../core/slot";
import { minutesToUtc } from "../../common/utils";
import type { PlaceInWindowOpts } from "./heuristic-placer.service";

/**
 * Policy B — places one `TASK` with the Disjoint-LinUCB policy
 * (`docs/adr/0001-linucb-model-design.md` §8, `docs/scheduler/reranking.md`):
 * a per-candidate-day `/predict`, then a single-pass score over the empty,
 * hard-constraint-feasible 15-minute slots —
 * `Σ_arm overlapRate·predicted + slotPreferenceScore` (D4) — earliest-start
 * tie-break. A slot may run past local midnight up to the deadline (D5).
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
    );
  }

  /**
   * Place one `TASK` within a bounded local-day range (used by the series
   * placer, which clamps each member's window and vetoes full days). `window`
   * is already clamped; at most {@link MAX_SCAN_DAYS} days are scanned.
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
    const extraOccupied: Interval[] = opts.extraOccupied ?? [];
    const todayStr = localDateStr(now, timezone);

    // --- per-day context vectors -----------------------------------------
    const days: CandidateDay[] = [];
    let scanned = 0;
    for (
      let dayStr = window.firstDayStr;
      dayStr <= window.lastDayStr && scanned < MAX_SCAN_DAYS;
      dayStr = addDaysStr(dayStr, 1), scanned++
    ) {
      if (opts.skipDay?.(dayStr)) continue;

      const dayStartMs = minutesToUtc(dayStr, 0, timezone).getTime();
      const dayEndMs = minutesToUtc(
        addDaysStr(dayStr, 1),
        0,
        timezone,
      ).getTime();

      const { occupied, workloadByType } = await loadDayLoad(this.prisma, {
        userId,
        dayStart: new Date(dayStartMs),
        dayEnd: new Date(dayEndMs),
        timezone,
        excludeSessionIds: [task.id],
        // See the post-midnight blocks a straddling placement must clear (D5).
        occupiedLookaheadMs: overhangMs,
      });

      const vector = buildContextVector({
        remainingDaysUntilDeadline: Math.max(
          0,
          Math.floor((deadlineMs - now.getTime()) / DAY_MS),
        ),
        durationMinutes: task.durationMinutes,
        preferenceMatrix,
        candidateIsoWeekday: isoWeekday(dayStr),
        candidateDaysFromNow: Math.max(0, dayDiffStr(todayStr, dayStr)),
        workloadByType,
        semesterPhase: null,
      });

      days.push({ dayStr, dayStartMs, dayEndMs, occupied, vector });
    }
    if (days.length === 0) return null;

    // --- one /predict for all days -------------------------------------------
    const loaded = await this.armStates.loadAll(userId);
    const wireState = {} as Record<SchedulingArm, BanditArmStateWire>;
    for (const arm of SCHEDULING_ARMS) {
      wireState[arm] = { A: loaded[arm].A, b: loaded[arm].b };
    }

    const scores = await this.bandit.predict(
      days.map((d) => ({ day: d.dayStr, x: d.vector })),
      wireState,
    );
    if (!scores) return null;

    // --- single-pass slot scoring (reranking.md §3 + D4 cold-start blend) ---
    let best: {
      startMs: number;
      score: number;
      arm: SchedulingArm;
      vector: number[];
    } | null = null;

    for (const day of days) {
      const dayScores = scores[day.dayStr] ?? ({} as Record<string, number>);
      const lowerMs = Math.max(ceilToSlot(day.dayStartMs), next15Ms);
      // A start owned by this day may run past midnight up to the deadline (D5).
      const upperMs = Math.min(day.dayEndMs + overhangMs, deadlineMs);
      const occupied =
        extraOccupied.length > 0
          ? [...day.occupied, ...extraOccupied]
          : day.occupied;

      for (
        let startMs = lowerMs;
        startMs + durationMs <= upperMs;
        startMs += SLOT_MS
      ) {
        const endMs = startMs + durationMs;
        if (overlapsAny(occupied, startMs, endMs)) continue;

        const { score: slotScore, topArm } = linucbSlotScore({
          startMs,
          endMs,
          timezone,
          armScores: dayScores,
          prefMatrix: preferenceMatrix,
        });

        if (
          best === null ||
          slotScore > best.score ||
          (slotScore === best.score && startMs < best.startMs)
        ) {
          best = { startMs, score: slotScore, arm: topArm, vector: day.vector };
        }
      }
    }

    if (!best) return null;
    return {
      scheduledStartTime: new Date(best.startMs),
      selectedArm: best.arm,
      featureVector: best.vector,
    };
  }
}
