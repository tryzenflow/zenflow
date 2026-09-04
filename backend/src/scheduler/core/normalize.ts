import { clamp } from "../../common/utils";

/**
 * Fixed-divisor feature normalization for the LinUCB context vector
 * (`docs/adr/0001-linucb-model-design.md` §5.2). Pure — no I/O, no clock.
 */

/** `duration` divisor: 480 min = 8 h maps to the top of the range. */
export const DURATION_DIVISOR = 480;

/** `workload_by_type` scheduled-hours divisor: 12 h/day saturates. */
export const WORKLOAD_HOURS_DIVISOR = 12;

/** `workload_by_type` session-count divisor: 8 sessions/day saturates. */
export const WORKLOAD_COUNT_DIVISOR = 8;

/** `clamp(x / divisor, 0, 1) · 2 − 1` — min-max scale to `[-1, 1]`, clamped. */
export function minMaxSigned(x: number, divisor: number): number {
  return clamp(x / divisor, 0, 1) * 2 - 1;
}
