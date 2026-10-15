import { MOVE_REWARD_SCALE_MINUTES } from "../constants";
import {
  OUTCOME_GRACE_MS,
  OUTCOME_MISS_CUTOFF_MS,
} from "../../common/constants";

/**
 * Pure delayed-reward math for LinUCB-placed sessions (ADR-0001 §7/§9,
 * ADR-0022). No I/O, no clock.
 */

/** Settled outcome of an unmoved placement, see {@link completionReward}. */
export type CompletionOutcome = "COMPLETED" | "SKIPPED" | "MISSED";

/**
 * Outcome of an unmoved TASK, or `null` while it is not settled yet. Settles
 * at `end + grace` for a check-off inside the slot (`COMPLETED`) or a skip
 * (`SKIPPED`). A check-off before `start` does not count, so the placement is
 * `MISSED` at `end + cutoff`, as is one with no check-off.
 */
export function completionReward(
  startMs: number,
  endMs: number,
  completedAtMs: number | null,
  skipped: boolean,
  nowMs: number,
  graceMs: number = OUTCOME_GRACE_MS,
  cutoffMs: number = OUTCOME_MISS_CUTOFF_MS,
): CompletionOutcome | null {
  if (nowMs < endMs + graceMs) return null;
  if (skipped) return "SKIPPED";
  if (completedAtMs !== null && completedAtMs >= startMs) return "COMPLETED";
  if (nowMs >= endMs + cutoffMs) return "MISSED";
  return null;
}

/**
 * Grades a drag/resize/pick displacement into a LinUCB reward in `[-1, 0]`:
 * `0` for a zero-distance move (e.g. a resize that doesn't shift the start),
 * otherwise a penalty that grows linearly with `|dragDistanceMinutes|` and
 * saturates at `-1` once the displacement reaches `MOVE_REWARD_SCALE_MINUTES`.
 */
export function dragDistanceReward(
  dragDistanceMinutes: number,
  scaleMinutes: number = MOVE_REWARD_SCALE_MINUTES,
): number {
  if (dragDistanceMinutes === 0) return 0;
  return -Math.min(1, Math.abs(dragDistanceMinutes) / scaleMinutes);
}
