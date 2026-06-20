import { TIME_GRANULARITY } from "../common/constants";

/**
 * Pure per-tag duration-bias blending + correction (docs/heuristic.md §Phase 2,
 * ADR-0001 §2). This is a permanent PREPROCESSING layer: the estimated duration
 * is bias-corrected *before* it reaches EDF, and the corrected value is always
 * rounded UP to the next 15-minute multiple (invariant #3 — no off-grid times).
 *
 * Pure: the per-tag `{ nₜ, bₜ }` table (sample count + multiplier, a rolling
 * `actual ÷ estimated` per tag) is aggregated from `TaskEvent` telemetry in the
 * SERVICE and handed in here. This file does no I/O — it only does the math, so
 * it is trivially unit-testable (invariant #2).
 */

/** One tag's evidence: `n` samples observed, blended multiplier `b` = actual÷estimated. */
export interface TagBias {
  /** Sample count for this tag (the blend weight). */
  n: number;
  /** This tag's bias multiplier (`actual ÷ estimated`, ≥ 0). */
  b: number;
}

/** Neutral bias — no correction applied (multiply by 1.0). */
export const NEUTRAL_BIAS = 1.0;

/**
 * Sample-weighted blend over a task's tags (the DEFAULT multi-tag resolution):
 *
 *   bias = Σ(nₜ · bₜ) / Σ(nₜ)
 *
 * so a well-evidenced tag's bias outweighs a one-sample fluke instead of either
 * blindly winning. Tags with no evidence (`n ≤ 0`) contribute nothing. An empty
 * table, or one with zero total weight, returns {@link NEUTRAL_BIAS} (1.0) — no
 * correction — which keeps a cold-start task at its typed estimate.
 */
export function blendBias(perTag: TagBias[]): number {
  let weightSum = 0;
  let weightedBiasSum = 0;
  for (const { n, b } of perTag) {
    if (!(n > 0)) continue;
    weightSum += n;
    weightedBiasSum += n * b;
  }
  return weightSum > 0 ? weightedBiasSum / weightSum : NEUTRAL_BIAS;
}

/**
 * Max-bias variant — take the LARGEST multiplier across a task's tags (ADR-0001
 * §2 "Conservative Max-Bias"). This systematically over-reserves multi-tagged
 * tasks (schedule inflation), so it is an OPT-IN ablation knob, **not** the
 * default (the default is {@link blendBias}); kept here so the §8 blend-vs-max
 * ablation can compare them. Tags with no evidence (`n ≤ 0`) are ignored; an
 * empty / evidence-free table returns {@link NEUTRAL_BIAS}.
 */
export function maxBias(perTag: TagBias[]): number {
  let max = -Infinity;
  for (const { n, b } of perTag) {
    if (!(n > 0)) continue;
    if (b > max) max = b;
  }
  return max > -Infinity ? max : NEUTRAL_BIAS;
}

/**
 * Apply a bias multiplier to an estimated duration and round UP to the next
 * 15-minute multiple (the grid invariant #3 — corrected durations never go
 * off-grid, and rounding up means we never under-reserve). The result is always
 * a positive multiple of {@link TIME_GRANULARITY}; a non-finite or non-positive
 * bias is treated as {@link NEUTRAL_BIAS} (no correction).
 */
export function correctDuration(estimatedMin: number, bias: number): number {
  const factor = Number.isFinite(bias) && bias > 0 ? bias : NEUTRAL_BIAS;
  const corrected = estimatedMin * factor;
  const grid = TIME_GRANULARITY;
  return Math.max(grid, Math.ceil(corrected / grid) * grid);
}
