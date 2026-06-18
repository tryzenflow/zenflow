import { EdfTask } from "./interfaces";

/**
 * The re-ranker seam the heuristic roadmap is built on (docs/heuristic.md,
 * Phase 1 → 2). The EDF packer enumerates a task's feasible start instants via
 * {@link feasibleSlots} and hands them to a `SlotReRanker`, which returns the
 * SAME candidates re-ordered by preference; the packer then takes the first.
 *
 * Phase 1 ships the {@link identityReRanker}: it returns the candidates
 * untouched, so the chosen slot is still EDF's earliest-fit and behaviour is
 * byte-for-byte unchanged. Phase 2's signed preference matrix slots in here as a
 * drop-in `SlotReRanker` that sorts by descending cell score without changing
 * the feasibility definition.
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
