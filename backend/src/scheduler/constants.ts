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
export const MAX_SERIES_PER_DAY = 1;

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
 * Weight and saturation point for the slot-scoring "stability" nudge
 * (`core/slot-score.ts`'s `stabilityScore`, used by both `bestFreeSlot` and
 * `linucb-best-slot.ts`'s `bestMinuteInArm`): a light penalty for moving a
 * session away from the start time the user last set manually, so it isn't
 * churned without good reason.
 *
 * `STABILITY_WEIGHT` caps the term's maximum contribution to the total
 * score. It has to stay well under the scale of the terms it sits beside:
 * LinUCB's own arm-score term is a weighted blend of `/predict` outputs
 * whose inputs (context features, rewards) are all clamped to `[-1, 1]`
 * (`docs/adr/0001-linucb-model-design.md` §4/§5), plus a bounded UCB
 * exploration bonus (`BANDIT_ALPHA · √(xᵀA⁻¹x)`) — so it typically lands in
 * the low single digits. The preference-matrix term (`slotPreferenceScore`)
 * sums per-hour cells that are themselves clamped to `[-1, 1]`. At
 * `STABILITY_WEIGHT = 0.1`, the stability term can contribute at most ±0.1
 * — an order of magnitude below either, so it can only break near-ties
 * between otherwise-similar candidates, never outweigh real personalization.
 *
 * `STABILITY_SATURATION_HOURS` is the distance at which the penalty maxes
 * out: beyond this many hours from the previous manually-set start, moving
 * even further away costs no more. Without a cap, a rescheduling window
 * spanning the full `MAX_SCAN_DAYS` horizon would let raw hour-distance grow
 * into the hundreds and swamp every other term — the same saturating-distance
 * shape already used for the `MOVE` reward (`MOVE_REWARD_SCALE_MINUTES`).
 */
export const STABILITY_WEIGHT = 0.1;
export const STABILITY_SATURATION_HOURS = 4;

/**
 * Weight of the fixed, post-hoc preference-matrix nudge used ONLY to rank
 * exact minutes within LinUCB's already-chosen arm (Item 3B1/B2) — never to
 * choose the arm itself (B2 picks the arm from LinUCB's own per-arm scores
 * alone), and never fed into LinUCB's context vector (`context-vector.ts`
 * zeroes `day_preference_profile[24]`, Item 3B1).
 *
 * LinUCB's own arm score (`θ̂ᵀx + α·√(xᵀA⁻¹x)`) is fit against rewards in
 * `[-1, 1]` (`SESSION_RETAINED_REWARD` / `SESSION_MOVE_REWARD` /
 * `dragDistanceReward`'s range — ADR-0001 §7), so a trained arm's score is
 * itself O(1) in typical magnitude, with the `α·√(...)` exploration term
 * adding at most roughly another unit early on (bounded by `α·√FEATURE_DIM ≈
 * 0.15·√46 ≈ 1.0` for a single early observation under the `λ = 1` ridge
 * prior, per ADR-0001 §6/§10) before shrinking as more data arrives.
 * `slotPreferenceScore` is duration-scaled (a sum over every clock-hour the
 * slot touches, so an N-hour slot's raw value is up to `N`, not `O(1)`) —
 * dividing by the slot's own duration-in-hours before applying this weight
 * (see `linucb-best-slot.ts`'s `bestMinuteInArm`) normalizes it back to the
 * same `[-1, 1]`-ish per-hour scale as a single arm score, so this weight is
 * directly comparable to "what fraction of one arm-score's typical
 * magnitude."
 * `0.1` caps the nudge at ±10% of that scale — enough to break near-ties
 * between minutes/days LinUCB itself can't yet distinguish and to soften
 * cold start (arm score `0.0` before an arm has any data — see
 * `services/bandit/README.md`'s `/predict` contract), never enough to read
 * as a second competing signal.
 */
export const PREFERENCE_NUDGE_WEIGHT = 0.1;

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

/**
 * Fraction of `TASK` create / deadline-change events (and, independently,
 * series members) that run **both** `HeuristicPlacer` and `BanditPlacer` and
 * get `SlotProposal.pairwiseShown = true` (`docs/scheduler/ab-testing.md`
 * §3). Every other event runs exactly one algorithm — the existing 50/50
 * `primaryPolicy` pick — same as before this existed. Independent draw from
 * `primaryPolicy`'s own 50/50 roll.
 */
export const PAIRWISE_SAMPLE_RATE = 0.2;
