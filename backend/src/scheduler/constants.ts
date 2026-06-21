/** How far ahead the engine will scan for an open slot for deadline-less tasks. */
export const MAX_SCAN_DAYS = 90;

export const MIN = 60_000;

/**
 * Softmax/Boltzmann TEMPERATURE for the Phase-2 placement re-ranker
 * ({@link preferenceMatrixReRanker}). Controls how greedily the stochastic
 * logging policy samples among EDF-feasible slots: `logit = cellScore / T +
 * gumbel`, argmax → choice.
 *
 * Why a stochastic policy at all: a pure argmax only ever logs outcomes for the
 * single top-scored slot, which (a) biases the telemetry the roadmap learns from
 * and (b) makes Inverse-Propensity-Scoring (IPS) off-policy evaluation
 * degenerate — IPS needs a stochastic logging policy with recorded
 * propensities (docs/heuristic.md §Evaluation, before Phase 3's bandit).
 *
 * Choosing T: the signed matrix accumulates `±1` per move/keep, so a "meaningful"
 * preference delta between two feasible slots is on the order of a few units (a
 * cell visited a handful of times). `T = 1.0` makes a 1-unit gap an `e¹ ≈ 2.7×`
 * odds ratio and a 3-unit gap ≈ `20×` — i.e. it still strongly prefers liked
 * slots while leaving real exploration mass on the rest. Larger T over-explores
 * (→ uniform, MAR regresses); `T → 0` recovers the deterministic argmax (today's
 * greedy Phase-2). Validated against the sim MAR guardrail (must not regress vs
 * greedy Phase-2; must still beat Phase-1) — tune DOWN if a run regresses.
 */
export const RERANKER_TEMPERATURE = 1.0;
