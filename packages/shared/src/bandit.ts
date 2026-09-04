/**
 * Wire contract between the NestJS backend and the stateless Python bandit
 * service (`services/bandit/`, reached at `BANDIT_SERVICE_URL`). The Python
 * service holds no per-user state — every `/predict` and `/update` call carries
 * the relevant `(A, b)` in its payload and the backend persists what comes back
 * (`BanditArmState`). See `docs/adr/0001-linucb-model-design.md`.
 */

/** The five canonical time-of-day arms (`docs/adr/0001-linucb-model-design.md` §2). */
export const SCHEDULING_ARMS = [
  "EARLY_MORNING",
  "MORNING",
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
export const FEATURE_DIM = 46;

/**
 * A single arm's persisted LinUCB state. `A` is row-major `d·d`, `b` is length
 * `d`. Empty arrays mean "cold prior" — the Python service substitutes
 * `A = ridge·I`, `b = 0`.
 */
export interface BanditArmStateWire {
  A: number[];
  b: number[];
}

/** `POST /predict` request body. */
export interface BanditPredictRequest {
  alpha: number;
  ridge: number;
  /** Per-arm `(A, b)`. A missing key or `{ A: [], b: [] }` means the cold prior. */
  state: Record<string, BanditArmStateWire>;
  /** One context vector per candidate day; `x` has length {@link FEATURE_DIM}. */
  contexts: { day: string; x: number[] }[];
}

/** `POST /predict` response — every one of the 5 arms scored for every day. */
export interface BanditPredictResponse {
  scores: Record<string, Record<string, number>>;
}

/** `POST /update` request body. */
export interface BanditUpdateRequest {
  ridge: number;
  arm: string;
  /** The context vector the proposal was scored with; length {@link FEATURE_DIM}. */
  x: number[];
  reward: number;
  state: BanditArmStateWire;
}

/** `POST /update` response — the new `(A, b)` after folding in the reward. */
export interface BanditUpdateResponse {
  A: number[];
  b: number[];
}
