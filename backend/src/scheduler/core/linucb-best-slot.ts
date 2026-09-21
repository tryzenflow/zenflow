import type { SchedulingArm } from "@zenflow/shared";
import {
  ARM_BANDS,
  TIE_BREAK_ARM_ORDER,
  armOfMinute,
  armOverlapRatesFromMinute,
  overlapRate,
} from "./arms";
import { adaptiveWeights, type SlotScoreWeights } from "./adaptive-weights";
import { slotPreferenceScore, stabilityScore } from "./slot-score";
import { utcToMinutes } from "../../common/utils";
import {
  ceilToSlot,
  MS_PER_MINUTE,
  overlapsAny,
  SLOT_MS,
  type Interval,
} from "./slot";

const HOUR_MS = 60 * MS_PER_MINUTE;
const MINUTES_PER_DAY = 1440;

/**
 * Slot-first LinUCB search over a pre-scored set of candidate days — pure,
 * no I/O, no clock, no randomness (CLAUDE.md invariant 2). Shared by the real
 * placer (`io/bandit-placer.service.ts`) and anything that must reproduce the
 * "arm scores -> concrete best slot" math (offline simulator, Python port #60,
 * golden fixtures `backend/scripts/export-golden-fixtures.ts`).
 *
 * Issue #62 A (ADR-0001 addendum) replaces the old arm-then-minute pick
 * (3B2): EVERY feasible 15-min start on EVERY candidate day is scored
 *
 *   score = wL * SUM_arm overlapRate(slot, arm) * armScore[day][arm]
 *         + wP * slotPreferenceScore(slot) / durationHours
 *         + stability
 *
 * and ranked across days. `(wL, wP)` come from {@link adaptiveWeights} (pref-
 * heavy while the user has no observations). A start may be as late as 23:45
 * with the session overhanging local midnight; `deadlineMs` is a hard ceiling
 * on the END (deadline need not be slot-aligned).
 *
 * Exact ties resolve deterministically: arm hosting the start in
 * {@link TIE_BREAK_ARM_ORDER} (MORNING first, never EARLY_MORNING), then the
 * earlier start.
 */

export interface LinucbCandidateDay {
  dayStr: string;
  dayStartMs: number;
  dayEndMs: number;
  occupied: Interval[];
  /** This day's context vector — echoed back on the winning day's slot. */
  vector: number[];
  /** Per-arm LinUCB scores for this day (`/predict`'s output; missing arm → 0). */
  armScores: Partial<Record<SchedulingArm, number>>;
}

export interface BestLinucbSlotInput {
  days: LinucbCandidateDay[];
  durationMinutes: number;
  timezone: string;
  /** The user's flat 168-cell preference matrix (D4 cold-start blend). */
  prefMatrix: number[];
  /** Earliest legal start (`ceilToSlot(now)`, typically). */
  nextMs: number;
  deadlineMs: number;
  /** Extra hard blocks on top of each day's own occupancy (series siblings). */
  extraOccupied?: Interval[];
  prevStartMs?: number;
  /**
   * The user's MOVE + RETAINED event count — drives {@link adaptiveWeights}.
   * Omitted = 0 (cold start).
   */
  observationCount?: number;
}

export interface BestLinucbSlot {
  startMs: number;
  score: number;
  /** Arm hosting the slot's START (what `/update` is later credited to). */
  arm: SchedulingArm;
  vector: number[];
  /** The weights applied — recorded on `SlotProposal`. */
  weights: SlotScoreWeights;
}

const TIE_RANK = new Map<SchedulingArm, number>(
  TIE_BREAK_ARM_ORDER.map((a, i) => [a, i]),
);

/** Per-arm overlap rates (ARM_BANDS order) for a slot on `day`. Fast
 * wall-clock arithmetic on 24h days; exact Intl-based fallback on DST days. */
function ratesForSlot(
  day: LinucbCandidateDay,
  startMs: number,
  durationMinutes: number,
  timezone: string,
): number[] {
  if (day.dayEndMs - day.dayStartMs === MINUTES_PER_DAY * MS_PER_MINUTE) {
    return armOverlapRatesFromMinute(
      (startMs - day.dayStartMs) / MS_PER_MINUTE,
      durationMinutes,
    );
  }
  const endMs = startMs + durationMinutes * MS_PER_MINUTE;
  return ARM_BANDS.map((b) => overlapRate(startMs, endMs, b.arm, timezone));
}

function startArm(
  day: LinucbCandidateDay,
  startMs: number,
  timezone: string,
): SchedulingArm {
  const isPlainDay =
    day.dayEndMs - day.dayStartMs === MINUTES_PER_DAY * MS_PER_MINUTE;
  return armOfMinute(
    isPlainDay
      ? (startMs - day.dayStartMs) / MS_PER_MINUTE
      : utcToMinutes(new Date(startMs), timezone),
  );
}

/**
 * Scores every feasible start (15-min aligned, not overlapping `occupied`,
 * end <= `deadlineMs`, start >= `nextMs`) across all `days` and returns the
 * best, or `null` when nothing is feasible (caller falls back to the
 * heuristic — same contract as before).
 */
export function bestLinucbSlot(
  input: BestLinucbSlotInput,
): BestLinucbSlot | null {
  const {
    days,
    durationMinutes,
    timezone,
    prefMatrix,
    nextMs,
    deadlineMs,
    extraOccupied = [],
    prevStartMs,
    observationCount = 0,
  } = input;

  const weights = adaptiveWeights(observationCount);
  const durationMs = durationMinutes * MS_PER_MINUTE;
  const durationHours = durationMs / HOUR_MS;
  const overhangMs = durationMs - SLOT_MS;

  let best: {
    startMs: number;
    score: number;
    arm: SchedulingArm;
    day: LinucbCandidateDay;
  } | null = null;

  for (const day of days) {
    const lowerMs = Math.max(ceilToSlot(day.dayStartMs), nextMs);
    const upperMs = Math.min(day.dayEndMs + overhangMs, deadlineMs);
    const occupied = extraOccupied.length
      ? [...day.occupied, ...extraOccupied]
      : day.occupied;

    for (
      let startMs = lowerMs;
      startMs + durationMs <= upperMs;
      startMs += SLOT_MS
    ) {
      const endMs = startMs + durationMs;
      if (overlapsAny(occupied, startMs, endMs)) continue;

      const rates = ratesForSlot(day, startMs, durationMinutes, timezone);
      let linucb = 0;
      for (let i = 0; i < ARM_BANDS.length; i++) {
        linucb += rates[i] * (day.armScores[ARM_BANDS[i].arm] ?? 0);
      }
      const pref =
        slotPreferenceScore(prefMatrix, startMs, endMs, timezone) /
        durationHours;
      const stability =
        prevStartMs !== undefined ? stabilityScore(prevStartMs, startMs) : 0;
      const score = weights.wL * linucb + weights.wP * pref + stability;

      const arm = startArm(day, startMs, timezone);
      if (
        best === null ||
        score > best.score ||
        (score === best.score &&
          (TIE_RANK.get(arm)! < TIE_RANK.get(best.arm)! ||
            (TIE_RANK.get(arm) === TIE_RANK.get(best.arm) &&
              startMs < best.startMs)))
      ) {
        best = { startMs, score, arm, day };
      }
    }
  }

  if (!best) return null;
  return {
    startMs: best.startMs,
    score: best.score,
    arm: best.arm,
    vector: best.day.vector,
    weights,
  };
}
