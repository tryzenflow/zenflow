import {
  LINUCB_WEIGHT_COLD,
  LINUCB_WEIGHT_WARM,
  PREFERENCE_WEIGHT_COLD,
  PREFERENCE_WEIGHT_WARM,
  WEIGHT_WARMUP_OBSERVATIONS,
} from "../constants";

/** Term weights applied to one LinUCB slot score. */
export interface SlotScoreWeights {
  /** Weight `wL` of the overlap-weighted LinUCB arm-score term. */
  wL: number;
  /** Weight `wP` of the (per-hour) preference-matrix term. */
  wP: number;
}

/**
 * Adaptive blend of the LinUCB and preference terms as a pure function of the
 * user's observation count (MOVE + RETAINED events). A brand-new user has no
 * learned arm weights, so the preference matrix dominates (`wP=1, wL=0.3`);
 * as observations accumulate the mix moves linearly toward LinUCB
 * (`wL=1, wP=0.1`) and saturates at `WEIGHT_WARMUP_OBSERVATIONS`. Monotonic:
 * `wL` never decreases and `wP` never increases with more data. Pure.
 */
export function adaptiveWeights(observationCount: number): SlotScoreWeights {
  const n = Number.isFinite(observationCount)
    ? Math.max(0, observationCount)
    : 0;
  const t = Math.min(1, n / WEIGHT_WARMUP_OBSERVATIONS);
  return {
    wL: LINUCB_WEIGHT_COLD * (1 - t) + LINUCB_WEIGHT_WARM * t,
    wP: PREFERENCE_WEIGHT_COLD * (1 - t) + PREFERENCE_WEIGHT_WARM * t,
  };
}
