import type { SchedulingArm } from "@zenflow/shared";
import { ARM_BANDS, armOfMinute, overlapRate } from "./arms";
import { slotPreferenceScore } from "./slot-score";

/**
 * LinUCB → concrete-slot score for one candidate 15-minute-aligned start
 * (`docs/scheduler/reranking.md` §3). Pure — no I/O, no clock, no randomness.
 *
 * ```text
 * score(c) = Σ_arm overlapRate(c, arm) · predicted[day][arm]   (the LinUCB term)
 *          + slotPreferenceScore(c)                            (D4 cold-start blend)
 * ```
 *
 * The preference addend is the same overlap-weighted heuristic score used by
 * Policy A (`slot-score.ts`), so a slot still ranks sensibly before any arm has
 * accumulated reward — a cold LinUCB arm scores `0` from the service, leaving
 * the preference term to break the tie.
 *
 * `armScores` is the `/predict` output for the candidate day (missing arm → 0).
 * A slot may span local midnight (D5): `overlapRate` splits it, so both the
 * pre- and post-midnight bands contribute.
 */
export interface LinucbSlotScoreInput {
  startMs: number;
  endMs: number;
  timezone: string;
  /** Per-arm LinUCB scores for the candidate day. */
  armScores: Partial<Record<SchedulingArm, number>>;
  /** The user's flat 168-cell preference matrix. */
  prefMatrix: number[];
}

export interface LinucbSlotScore {
  score: number;
  /** The arm contributing the largest `overlapRate · predicted` term (rate breaks ties). */
  topArm: SchedulingArm;
}

export function linucbSlotScore(input: LinucbSlotScoreInput): LinucbSlotScore {
  const { startMs, endMs, timezone, armScores, prefMatrix } = input;

  let armTerm = 0;
  let topArm: SchedulingArm = armOfMinute(0);
  let topTermValue = -Infinity;
  let topRate = -Infinity;

  for (const band of ARM_BANDS) {
    const rate = overlapRate(startMs, endMs, band.arm, timezone);
    if (rate === 0) continue;
    const term = rate * (armScores[band.arm] ?? 0);
    armTerm += term;
    if (term > topTermValue || (term === topTermValue && rate > topRate)) {
      topTermValue = term;
      topRate = rate;
      topArm = band.arm;
    }
  }

  const score =
    armTerm + slotPreferenceScore(prefMatrix, startMs, endMs, timezone);
  return { score, topArm };
}
