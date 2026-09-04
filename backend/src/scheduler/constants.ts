/**
 * How far ahead the engine will scan for an open slot, and the ~2-month
 * effective deadline horizon.
 *
 * NOTE: `docs/adr/0001-linucb-model-design.md` §5.2/§10 quote `MAX_SCAN_DAYS = 90`.
 * The code ships 60; it is also the `minMaxSigned` divisor for the context
 * vector's `remaining_days_until_deadline` / `candidate_days_from_now` features,
 * so changing it shifts every long-horizon placement AND every stored feature
 * vector. Left at 60 deliberately — see the ADR addendum.
 */
export const MAX_SCAN_DAYS = 60;

/** Max sessions of one `TASK` series allowed to land on a single calendar day (issue #32). */
export const MAX_SERIES_PER_DAY = 3;

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
 * Reward written on the `SessionEvent` for each outcome of the move-or-keep
 * model. A user drag/resize of a scheduled TASK is a negative signal; a TASK
 * that elapses unmoved (detected by the RETAINED sweep) is a positive one.
 * `CREATE` events carry a neutral 0.
 */
export const SESSION_MOVE_REWARD = -1.0;
export const SESSION_RETAINED_REWARD = 1.0;

/**
 * Disjoint LinUCB scheduling parameters
 * (`docs/adr/0001-linucb-model-design.md` §10). `BANDIT_ALPHA` is the
 * exploration coefficient on `α·√(xᵀA⁻¹x)`; `BANDIT_RIDGE` is the ridge `λ`
 * (`A = λI` at cold start). Both are sent to the Python bandit service in every
 * `/predict` / `/update` payload.
 */
export const BANDIT_ALPHA = 0.15;
export const BANDIT_RIDGE = 1.0;

/**
 * `D_SCALE` for the graded `MOVE` reward: the displacement (in minutes, from
 * the model's originally proposed start) at which the penalty saturates at −1.
 * `reward = dragDistanceMinutes === 0 ? 0 : -min(1, |drag| / MOVE_REWARD_SCALE_MINUTES)`.
 */
export const MOVE_REWARD_SCALE_MINUTES = 240;

/** Stamped on `SlotProposal.modelVersion` for LinUCB proposals. */
export const BANDIT_MODEL_VERSION = "linucb-d46-v1";

/** `SlotProposal.experimentId` for the heuristic-vs-LinUCB A/B experiment. */
export const BANDIT_EXPERIMENT_ID = "linucb-heuristic-v1";
