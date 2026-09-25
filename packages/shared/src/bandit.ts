/**
 * Wire contract between the NestJS backend and the stateless Python bandit
 * service (`services/bandit/`, reached at `BANDIT_SERVICE_URL`). The Python
 * service holds no per-user state — every `/v1/place` and `/v1/update` call carries
 * the relevant `(A, b)` in its payload and the backend persists what comes back
 * (`BanditArmState`). See `docs/adr/0001-linucb-model-design.md`.
 */

/** The six canonical time-of-day arms (`docs/adr/0001-linucb-model-design.md` §2). */
export const SCHEDULING_ARMS = [
  "EARLY_MORNING",
  "MORNING",
  "MIDDAY",
  "AFTERNOON",
  "EVENING",
  "NIGHT",
] as const;

export type SchedulingArm = (typeof SCHEDULING_ARMS)[number];

/**
 * Context-vector width (`docs/adr/0001-linucb-model-design.md` §5.1). Fixes the
 * stored widths of `BanditArmState.A` (d·d), `BanditArmState.b` (d) and
 * `SlotProposal.featureVector` (d). Changing it is a migration.
 */
export const FEATURE_DIM = 7;

/**
 * A single arm's persisted LinUCB state. `A` is row-major `d·d`, `b` is length
 * `d`. Empty arrays mean "cold prior" — the Python service substitutes
 * `A = ridge·I`, `b = 0`.
 */
export interface BanditArmStateWire {
  A: number[];
  b: number[];
}

/** `POST /v1/update` request body. */
export interface BanditUpdateRequest {
  ridge: number;
  arm: string;
  /** The context vector the proposal was scored with; length {@link FEATURE_DIM}. */
  x: number[];
  reward: number;
  state: BanditArmStateWire;
}

/** `POST /v1/update` response — the new `(A, b)` after folding in the reward. */
export interface BanditUpdateResponse {
  A: number[];
  b: number[];
}
