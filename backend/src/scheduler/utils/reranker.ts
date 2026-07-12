import { PREFERENCE_MATRIX_LENGTH } from "@zenflow/shared";
import { preferenceIndex, type Interval } from "./slot";
import { RERANKER_TEMPERATURE } from "../constants";
import { gumbelNoise, mulberry32, seedFromString } from "./rng";

/**
 * Phase-2 softmax/Gumbel-top re-ranker (docs/heuristic.md §Phase 2). Re-ranks
 * WITHIN the EDF-feasible set only — it never invents or drops a candidate,
 * it only reorders/annotates. Pure: randomness enters only via a PRNG seeded
 * from the task id (never `now`), so re-packing the same task on an unrelated
 * cascade yields the same draw (no slot churn).
 */

export interface RankedCandidate {
  start: Date;
  end: Date;
  /** The raw preference-matrix cell score for this candidate (0 = neutral). */
  score: number;
  /**
   * This candidate's softmax first-choice probability
   * `exp(score/T) / Σ_j exp(score_j/T)` — the TRUE logging-policy propensity,
   * recorded for IPS/SNIPS off-policy replay. Uniform `1/n` on cold start.
   */
  propensity: number;
}

/**
 * Re-rank `candidates` (an EDF-feasible set) by the user's signed preference
 * matrix via the Gumbel-top trick: `logit_i = cellScore_i/T + gumbel_i`,
 * sorted descending. The Gumbel noise is drawn from ONE `mulberry32` generator
 * seeded from `taskId` (via {@link seedFromString}), consumed exactly once per
 * candidate in stable input order — so the draw is a deterministic function of
 * `(taskId, candidate list)`.
 *
 * Cold start (matrix empty/wrong length, or every feasible cell scores 0 — the
 * common new-user case) skips the Gumbel draw entirely and returns the
 * candidates in their original (identity/earliest-first) order with uniform
 * propensity `1/n`, rather than randomly shuffling a fresh user's tasks.
 */
export function rankCandidates(
  candidates: Interval[],
  matrix: readonly number[],
  timezone: string,
  taskId: string,
  temperature: number = RERANKER_TEMPERATURE,
): RankedCandidate[] {
  if (candidates.length === 0) return [];

  const validMatrix = matrix.length === PREFERENCE_MATRIX_LENGTH;
  const cellScores = candidates.map((c) =>
    validMatrix ? matrix[preferenceIndex(new Date(c.start), timezone)] : 0,
  );
  const coldStart = !validMatrix || cellScores.every((s) => s === 0);

  if (coldStart) {
    const propensity = 1 / candidates.length;
    return candidates.map((c, i) => ({
      start: new Date(c.start),
      end: new Date(c.end),
      score: cellScores[i],
      propensity,
    }));
  }

  const T = temperature > 0 ? temperature : RERANKER_TEMPERATURE;
  const expScores = cellScores.map((s) => Math.exp(s / T));
  const sumExp = expScores.reduce((a, b) => a + b, 0);
  const propensities = expScores.map((e) => e / sumExp);

  // ONE seeded generator per task id, consumed once per candidate in stable
  // input order — deterministic regardless of any later sort.
  const rand = mulberry32(seedFromString(taskId));
  const logits = cellScores.map((s) => s / T + gumbelNoise(rand));

  const order = candidates.map((_, i) => i);
  order.sort((a, b) => logits[b] - logits[a]);

  return order.map((i) => ({
    start: new Date(candidates[i].start),
    end: new Date(candidates[i].end),
    score: cellScores[i],
    propensity: propensities[i],
  }));
}

/** The single top-ranked candidate, or null when `candidates` is empty. */
export function pickBest(
  candidates: Interval[],
  matrix: readonly number[],
  timezone: string,
  taskId: string,
  temperature: number = RERANKER_TEMPERATURE,
): RankedCandidate | null {
  return (
    rankCandidates(candidates, matrix, timezone, taskId, temperature)[0] ?? null
  );
}

/** The top `n` ranked candidates (fewer if `candidates` is shorter than `n`). */
export function topN(
  candidates: Interval[],
  matrix: readonly number[],
  timezone: string,
  taskId: string,
  n: number,
  temperature: number = RERANKER_TEMPERATURE,
): RankedCandidate[] {
  return rankCandidates(
    candidates,
    matrix,
    timezone,
    taskId,
    temperature,
  ).slice(0, n);
}
