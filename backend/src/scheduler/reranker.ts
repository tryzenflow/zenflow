import { PREFERENCE_MATRIX_LENGTH } from "@zenflow/shared";
import { RERANKER_TEMPERATURE } from "./constants";
import { EdfTask } from "./interfaces";
import { preferenceIndex } from "./slot";
import { gumbel, hashSeed, makeRng } from "./rng";

/**
 * The re-ranker seam the heuristic roadmap is built on (docs/heuristic.md,
 * Phase 1 → 2). The EDF packer enumerates a task's feasible start instants via
 * {@link feasibleSlots} and hands them to a `SlotReRanker`, which returns the
 * SAME candidates re-ordered by preference; the packer then takes the first.
 *
 * Phase 1 ships the {@link identityReRanker}: it returns the candidates
 * untouched, so the chosen slot is still EDF's earliest-fit and behaviour is
 * byte-for-byte unchanged. Phase 2's signed preference matrix slots in here as a
 * drop-in `SlotReRanker` ({@link preferenceMatrixReRanker}) that re-ranks the
 * feasible set toward liked day×block cells via SOFTMAX/BOLTZMANN EXPLORATION
 * (not a pure argmax), so the chosen slot is a *sampled* draw with a recorded
 * propensity — see {@link SlotReRanker.propensity} and docs/heuristic.md
 * §Evaluation for why off-policy IPS needs a stochastic logging policy.
 */
export interface SlotReRanker {
  /**
   * Re-order `candidates` (all feasible, grid-aligned, deadline-respecting start
   * instants for `task`, already ascending by time) by preference, most
   * preferred first. Must be a pure permutation of its input — it may neither
   * add nor drop candidates, only reorder them. The packer takes `[0]`.
   */
  score(task: EdfTask, candidates: Date[]): Date[];

  /**
   * The probability this (logging) policy assigns to having put `chosen` FIRST —
   * i.e. the marginal that `score(task, candidates)[0] === chosen`. This is the
   * propensity that off-policy IPS/SNIPS evaluation divides by (docs/heuristic.md
   * §Evaluation). For the softmax policy it is the closed-form first-choice
   * softmax marginal `exp(score_chosen/T) / Σ_j exp(score_j/T)`; for the identity
   * / cold-start policy it is uniform `1/n`. Pure (no RNG): a marginal, not a draw.
   */
  propensity(task: EdfTask, candidates: Date[], chosen: Date): number;
}

/**
 * The Phase-1 identity re-ranker: returns the feasible set unchanged, so the
 * packer keeps picking EDF's earliest-fit slot. This is the neutral baseline the
 * spec mandates before any personalization is layered on. Its propensity is
 * uniform over the candidates — it expresses no preference, so off-policy
 * evaluation treats every feasible slot as equally likely to have been logged.
 */
export const identityReRanker: SlotReRanker = {
  score(_task: EdfTask, candidates: Date[]): Date[] {
    return candidates;
  },
  propensity(_task: EdfTask, candidates: Date[]): number {
    return candidates.length > 0 ? 1 / candidates.length : 1;
  },
};

/**
 * Read a cell from the flat 168-cell signed preference matrix for an instant in
 * the user's `timezone`, via the shared {@link preferenceIndex} grid math
 * (`(isoWeekday-1)*24 + hour`). A cold-start / wrong-length matrix and any
 * out-of-range index read as `0` (neutral), so the re-ranker degrades to
 * identity rather than throwing.
 */
function cellScore(
  matrix: readonly number[],
  at: Date,
  timezone: string,
): number {
  if (matrix.length !== PREFERENCE_MATRIX_LENGTH) return 0;
  const i = preferenceIndex(at, timezone);
  return i >= 0 && i < matrix.length ? matrix[i] : 0;
}

/** True iff every score in `scores` is (numerically) the same — the cold-start
 * / neutral case where there is no preference signal to act on. */
function allEqual(scores: number[]): boolean {
  for (let i = 1; i < scores.length; i++) {
    if (scores[i] !== scores[0]) return false;
  }
  return true;
}

/**
 * Softmax first-choice marginal over `scores` at temperature `T`: the
 * probability the argmax of `score/T + gumbel` lands on index `chosenIdx`. By
 * the Gumbel-max identity this is exactly `exp(score_i/T) / Σ_j exp(score_j/T)`.
 * Computed with the standard max-subtraction trick for numerical stability.
 */
function softmaxProbability(
  scores: number[],
  chosenIdx: number,
  temperature: number,
): number {
  if (scores.length === 0 || chosenIdx < 0) return 0;
  const max = Math.max(...scores);
  let denom = 0;
  for (const s of scores) denom += Math.exp((s - max) / temperature);
  return Math.exp((scores[chosenIdx] - max) / temperature) / denom;
}

/** Options for the Phase-2 softmax re-ranker. */
export interface ReRankerOptions {
  /**
   * Softmax/Boltzmann temperature (default {@link RERANKER_TEMPERATURE}). Higher
   * = more exploration; `T → 0` recovers the deterministic argmax (greedy
   * Phase-2). Must be > 0.
   */
  temperature?: number;
  /**
   * Base seed mixed with the per-task id hash to seed the Gumbel draw. The
   * SERVICE supplies this (invariant #2: the seed is computed outside the pure
   * core and passed in), so different users/runs explore independently while a
   * given (task, base seed) pair stays reproducible. Defaults to 0.
   */
  seed?: number;
}

/**
 * Phase-2 placement re-ranker (docs/heuristic.md §Phase 2, ADR-0001 §1) with
 * SOFTMAX/BOLTZMANN EXPLORATION.
 *
 * Constructed with the user's **168-cell signed** preference matrix (7 ISO
 * weekdays × 24 one-hour buckets) and their IANA `timezone` — both passed
 * in by `SchedulerService` (invariant #2: the core stays pure; the matrix, the
 * temperature, and the RNG seed are all computed in the service and handed in).
 *
 * Instead of a deterministic argmax (which only ever logs the single
 * top-scored slot → biased telemetry + degenerate IPS), `score` samples a slot
 * via the **Gumbel-top trick**: `logit_i = cellScore_i / T + gumbel(rng)`, sort
 * by logit descending, take `[0]`. Adding i.i.d. Gumbel(0,1) noise to each logit
 * and taking the argmax draws EXACTLY from the softmax `p_i ∝ exp(score_i/T)`,
 * while the returned array is still a pure PERMUTATION of the input (it only
 * reorders the original elements). This makes the logging policy stochastic and
 * gives every decision a well-defined {@link SlotReRanker.propensity} that
 * off-policy IPS/SNIPS can divide by.
 *
 * Three hard guarantees (see `reranker.spec.ts`):
 *  - **`T → 0` recovers the argmax.** As `T → 0` the `score/T` term dominates the
 *    O(1) Gumbel noise, so the highest-cell-score slot wins deterministically —
 *    today's greedy Phase-2.
 *  - **Cold-start does NOT regress.** When every candidate scores EQUALLY (an
 *    all-zero / wrong-length / neutral matrix, the common cold-start case) there
 *    is no preference to act on, so we return the candidates UNCHANGED — the
 *    deterministic EDF earliest-fit order — rather than Gumbel-shuffling them
 *    (which would scatter a new user's tasks at random). Cold-start propensity is
 *    uniform `1/n`.
 *  - **Per-task seed stability.** The Gumbel seed is derived from the TASK ID
 *    ONLY (`hashSeed(task.id) ^ baseSeed`), never from `now`. Re-packing the same
 *    task on an unrelated cascade therefore yields the SAME sampled draw — no
 *    slot churn → protects the Time-to-stable metric.
 */
export function preferenceMatrixReRanker(
  matrix: readonly number[],
  timezone: string,
  options: ReRankerOptions = {},
): SlotReRanker {
  const temperature = options.temperature ?? RERANKER_TEMPERATURE;
  const baseSeed = options.seed ?? 0;

  const scoresOf = (candidates: Date[]): number[] =>
    candidates.map((c) => cellScore(matrix, c, timezone));

  return {
    score(task: EdfTask, candidates: Date[]): Date[] {
      if (candidates.length < 2) return candidates;
      const scores = scoresOf(candidates);
      // Cold-start / neutral: no preference signal → keep EDF earliest-fit order
      // exactly (do NOT shuffle a fresh user's tasks at random). This is the
      // exact byte-for-byte identity case the spec mandates.
      if (allEqual(scores)) return candidates;

      // Gumbel-top trick: per-task-seeded so re-packs are stable (no churn). T→0
      // collapses to argmax because score/T dominates the O(1) Gumbel noise.
      const rng = makeRng(hashSeed(task.id) ^ baseSeed);
      const logits = scores.map((s) => s / temperature + gumbel(rng));
      // Sort an index permutation so the result is provably a permutation of the
      // input, tie-breaking on the original position (EDF earliest-fit) for
      // determinism on the measure-zero exact-logit tie.
      const order = candidates.map((_, i) => i);
      order.sort((a, b) => logits[b] - logits[a] || a - b);
      return order.map((i) => candidates[i]);
    },

    propensity(task: EdfTask, candidates: Date[], chosen: Date): number {
      if (candidates.length === 0) return 1;
      const idx = candidates.findIndex((c) => c.getTime() === chosen.getTime());
      if (idx < 0) return 0;
      const scores = scoresOf(candidates);
      // Cold-start / neutral: uniform, matching the identity policy this case
      // degenerates to in `score`.
      if (allEqual(scores)) return 1 / candidates.length;
      return softmaxProbability(scores, idx, temperature);
    },
  };
}
