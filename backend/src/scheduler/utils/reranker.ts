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
  /** The raw score fed to the ranker for this candidate (0 = neutral). */
  score: number;
  /**
   * This candidate's softmax first-choice probability
   * `exp(score/T) / Σ_j exp(score_j/T)` — the TRUE logging-policy propensity,
   * recorded for IPS/SNIPS off-policy replay. Uniform `1/n` when every
   * candidate scores the same (cold start / a genuine tie).
   */
  propensity: number;
}

/** The raw preference-matrix cell score for a candidate (0 = neutral/invalid matrix). */
export function cellScore(
  candidate: Interval,
  matrix: readonly number[],
  timezone: string,
): number {
  if (matrix.length !== PREFERENCE_MATRIX_LENGTH) return 0;
  return matrix[preferenceIndex(new Date(candidate.start), timezone)];
}

/**
 * Re-rank `candidates` by an arbitrary pre-computed `scores` array (one per
 * candidate, higher = more preferred) via the Gumbel-top trick:
 * `logit_i = score_i/T + gumbel_i`, sorted descending. The Gumbel noise is
 * drawn from ONE `mulberry32` generator seeded from `taskId` (via
 * {@link seedFromString}), consumed exactly once per candidate in stable
 * input order — so the draw is a deterministic function of
 * `(taskId, candidate list, scores)`. This is the shared stochastic-logging-
 * policy primitive both the preference-matrix re-ranker ({@link rankCandidates})
 * and `place.ts`'s single-task `placeTask` (Tier-1 candidate pick) and
 * `optimize.ts`'s Mode-3 candidate scoring route through, so IPS/SNIPS
 * propensity logging works uniformly across all of them.
 *
 * When every candidate scores identically (no signal to distinguish them —
 * cold start, or a genuine tie) the Gumbel draw is skipped entirely and
 * candidates come back in their original (identity/earliest-first) order with
 * uniform propensity `1/n`, rather than injecting noise where there's nothing
 * to rank.
 */
export function rankByScores(
  candidates: Interval[],
  scores: number[],
  taskId: string,
  temperature: number = RERANKER_TEMPERATURE,
): RankedCandidate[] {
  if (candidates.length === 0) return [];

  const allEqual = scores.every((s) => s === scores[0]);
  if (allEqual) {
    const propensity = 1 / candidates.length;
    return candidates.map((c, i) => ({
      start: new Date(c.start),
      end: new Date(c.end),
      score: scores[i],
      propensity,
    }));
  }

  const T = temperature > 0 ? temperature : RERANKER_TEMPERATURE;
  const expScores = scores.map((s) => Math.exp(s / T));
  const sumExp = expScores.reduce((a, b) => a + b, 0);
  const propensities = expScores.map((e) => e / sumExp);

  // ONE seeded generator per task id, consumed once per candidate in stable
  // input order — deterministic regardless of any later sort.
  const rand = mulberry32(seedFromString(taskId));
  const logits = scores.map((s) => s / T + gumbelNoise(rand));

  const order = candidates.map((_, i) => i);
  order.sort((a, b) => logits[b] - logits[a]);

  return order.map((i) => ({
    start: new Date(candidates[i].start),
    end: new Date(candidates[i].end),
    score: scores[i],
    propensity: propensities[i],
  }));
}

/**
 * Re-rank `candidates` (an EDF-feasible set) by the user's signed preference
 * matrix — the Phase-2 rationale-driven re-ranker used by `SchedulerService.
 * simulate()` for the not-yet-created draft-task preview. Derives one score
 * per candidate via {@link cellScore} and delegates to {@link rankByScores}.
 */
export function rankCandidates(
  candidates: Interval[],
  matrix: readonly number[],
  timezone: string,
  taskId: string,
  temperature: number = RERANKER_TEMPERATURE,
): RankedCandidate[] {
  const scores = candidates.map((c) => cellScore(c, matrix, timezone));
  return rankByScores(candidates, scores, taskId, temperature);
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
