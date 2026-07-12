/** How far ahead the engine will scan for an open slot for deadline-less tasks. */
export const MAX_SCAN_DAYS = 90;

/**
 * Per-update step size η for preference-matrix acquisition.
 *
 * Each accepted/rejected event moves the corresponding hour-bucket cell by
 * `η × delta` rather than a raw `±1`, so a single action nudges the weight
 * instead of spiking it. A slot needs roughly `1/η` consistent signals to
 * accumulate a full ±1 unit — at η=0.1, ten consecutive COMPLETE events in
 * the same bucket converge to +1.0 (the same theoretical ceiling as before,
 * just reached gradually). The existing exponential time-decay in
 * `matrix-decay.ts` (half-life 21 days) erodes stale values on the nightly
 * cron independently of this constant.
 */
export const PREFERENCE_LEARNING_RATE = 0.1;

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
 * cell visited a handful of times). With 1-hour buckets cells accumulate signal
 * ~4× faster than the old 15-min slots, so meaningful deltas appear sooner —
 * a user needs far fewer interactions before the matrix has actionable signal.
 * `T = 1.0` makes a 1-unit gap an `e¹ ≈ 2.7×` odds ratio and a 3-unit gap
 * ≈ `20×` — i.e. it still strongly prefers liked buckets while leaving real
 * exploration mass on the rest. A 3-unit delta will be reached faster now that
 * each move/keep touches a coarser cell. Larger T over-explores (→ uniform,
 * MAR regresses); `T → 0` recovers the deterministic argmax (today's greedy
 * Phase-2). T=1.0 remains valid but may benefit from downward tuning once real
 * data confirms faster convergence. Validated against the sim MAR guardrail
 * (must not regress vs greedy Phase-2; must still beat Phase-1) — tune DOWN if
 * a run regresses.
 */
export const RERANKER_TEMPERATURE = 1.0;

/**
 * Continuous soft-constraint cost model (replaces the old hard
 * `manuallyMoved` freeze + hard deadline cutoff — see `edf.ts`'s module doc
 * comment). Tolerance for moving a task off its current anchor scales
 * continuously with how far in the future that anchor sits; deadlines and
 * work-hours preference are now cost terms instead of hard tiers. v1
 * defaults — deliberately plain, tunable later once real telemetry exists.
 */

/**
 * Beyond this many days out from `now`, an anchor's deviation weight bottoms
 * out at {@link DEVIATION_WEIGHT_FAR} (never goes lower — there's no bonus for
 * being EVEN further out).
 */
export const DEVIATION_HORIZON_DAYS = 7;

/**
 * Deviation weight for a task anchored at (or before) `now`: moving it 1
 * minute away from its current slot costs 1 unit. Tasks already in progress
 * or past never reach this — they're hard-frozen (see `isPast`) — this is the
 * weight for a task anchored in the very near future.
 */
export const DEVIATION_WEIGHT_NEAR = 1.0;

/**
 * Deviation weight for a task anchored at/beyond {@link DEVIATION_HORIZON_DAYS}
 * out: 10× cheaper to move than a near-term anchor, so far-future tasks
 * negotiate readily when a nearer-term task needs their slot.
 */
export const DEVIATION_WEIGHT_FAR = 0.1;

/**
 * Cost per minute a candidate placement ends past a task's deadline, in the
 * same "minutes of deviation" units `deviationCost` uses. Deliberately >
 * {@link HOURS_RATE}: deadline pressure must keep beating work-hours
 * preference, the same priority the old 3-tier fallback enforced structurally
 * (Tier 2 outside-hours-before-deadline beats Tier 3 in-hours-past-deadline).
 */
export const LATENESS_RATE = 4;

/**
 * Cost per minute a candidate placement falls outside the user's work-hours
 * window, in the same units. See {@link LATENESS_RATE}'s doc comment for why
 * this must stay smaller than it.
 */
export const HOURS_RATE = 2;
