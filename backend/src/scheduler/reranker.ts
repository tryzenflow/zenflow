import { PREFERENCE_MATRIX_LENGTH } from "@zenflow/shared";
import { EdfTask } from "./interfaces";
import { preferenceIndex } from "./slot";

/**
 * The re-ranker seam the heuristic roadmap is built on (docs/heuristic.md,
 * Phase 1 → 2). The EDF packer enumerates a task's feasible start instants via
 * {@link feasibleSlots} and hands them to a `SlotReRanker`, which returns the
 * SAME candidates re-ordered by preference; the packer then takes the first.
 *
 * Phase 1 ships the {@link identityReRanker}: it returns the candidates
 * untouched, so the chosen slot is still EDF's earliest-fit and behaviour is
 * byte-for-byte unchanged. Phase 2's signed preference matrix slots in here as a
 * drop-in `SlotReRanker` ({@link preferenceMatrixReRanker}) that sorts by
 * descending cell score without changing the feasibility definition.
 */
export interface SlotReRanker {
  /**
   * Re-order `candidates` (all feasible, grid-aligned, deadline-respecting start
   * instants for `task`, already ascending by time) by preference, most
   * preferred first. Must be a pure permutation of its input — it may neither
   * add nor drop candidates, only reorder them.
   */
  score(task: EdfTask, candidates: Date[]): Date[];
}

/**
 * The Phase-1 identity re-ranker: returns the feasible set unchanged, so the
 * packer keeps picking EDF's earliest-fit slot. This is the neutral baseline the
 * spec mandates before any personalization is layered on.
 */
export const identityReRanker: SlotReRanker = {
  score(_task: EdfTask, candidates: Date[]): Date[] {
    return candidates;
  },
};

/**
 * Read a cell from the flat 672-cell signed preference matrix for an instant in
 * the user's `timezone`, via the shared {@link preferenceIndex} grid math
 * (`(isoWeekday-1)*96 + slotOfDay`). A cold-start / wrong-length matrix and any
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

/**
 * Phase-2 placement re-ranker (docs/heuristic.md §Phase 2, ADR-0001 §1).
 *
 * Constructed with the user's **672-cell signed** preference matrix (7 ISO
 * weekdays × 96 fifteen-minute blocks) and their IANA `timezone` — both passed
 * in by `SchedulerService` (invariant #2: the core stays pure / I/O-free; the
 * matrix is computed in the service and handed in).
 *
 * `score(task, candidates)` returns the SAME candidate set **re-ordered by
 * descending cell score** — a pure permutation that adds nothing and drops
 * nothing. Ties (equal cell score, common on a sparse matrix) break on the
 * original EDF time order, which keeps the result deterministic and makes an
 * empty / cold-start matrix degenerate to identity (every cell scores 0, so the
 * stable sort preserves the incoming earliest-fit order exactly).
 *
 * The sort is stable because it sorts an index permutation and tie-breaks on the
 * original index, so the returned array is provably a permutation of the input
 * (see `reranker.spec.ts`).
 */
export function preferenceMatrixReRanker(
  matrix: readonly number[],
  timezone: string,
): SlotReRanker {
  return {
    score(_task: EdfTask, candidates: Date[]): Date[] {
      if (candidates.length < 2) return candidates;
      // Sort an index permutation so the result is provably a permutation of the
      // input (it only reorders the original elements), with a stable tie-break
      // on the original position to preserve EDF's earliest-fit order.
      const scores = candidates.map((c) => cellScore(matrix, c, timezone));
      const order = candidates.map((_, i) => i);
      order.sort((a, b) => scores[b] - scores[a] || a - b);
      return order.map((i) => candidates[i]);
    },
  };
}
