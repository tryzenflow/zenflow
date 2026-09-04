/**
 * Module-level types for the bandit slice (HTTP client + `(A, b)` persistence).
 * The wire contract types (`BanditPredictRequest`, …) live in `@zenflow/shared`.
 */

/** One arm's `(A, b)` as loaded from `BanditArmState`, with its concurrency version. */
export interface LoadedArmState {
  /** Row-major `d·d` design matrix; `[]` = cold prior. */
  A: number[];
  /** Length-`d` response vector; `[]` = cold prior. */
  b: number[];
  /** Optimistic-concurrency guard for `BanditArmStateRepository.save`. */
  version: number;
}
