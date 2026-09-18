import { FEATURE_DIM } from "@zenflow/shared";
import { clamp } from "../../common/utils";
import { MAX_SCAN_DAYS } from "../constants";
import {
  WORKLOAD_TYPES,
  type ContextVectorInput,
} from "../types/context-vector.types";
import {
  DURATION_DIVISOR,
  minMaxSigned,
  WORKLOAD_COUNT_DIVISOR,
  WORKLOAD_HOURS_DIVISOR,
} from "./normalize";

/**
 * Builds the Disjoint-LinUCB context vector `x`
 * (`docs/adr/0001-linucb-model-design.md` §5, `d = 46`).
 *
 * Pure: no I/O, no clock, no randomness. The caller (`BanditScheduleService`)
 * is responsible for computing `remainingDaysUntilDeadline`,
 * `candidateDaysFromNow`, the per-day `workloadByType`, and `semesterPhase`.
 * Types + enumerations live in `context-vector.types.ts`; the normalization
 * transforms in `utils/normalize.ts`.
 *
 * Returns exactly {@link FEATURE_DIM} (46) elements, in the ADR §5.1 order:
 * `remaining_days_until_deadline`, `duration`, `day_preference_profile[24]`
 * (reserved, always 0 — Item 3B1, see below), `day_of_week[7]`,
 * `candidate_days_from_now`, `workload_by_type[10]`, `semester_phase`, bias.
 */
export function buildContextVector(input: ContextVectorInput): number[] {
  const vec: number[] = [];

  // 1. remaining_days_until_deadline
  vec.push(minMaxSigned(input.remainingDaysUntilDeadline, MAX_SCAN_DAYS));

  // 2. duration
  vec.push(minMaxSigned(input.durationMinutes, DURATION_DIVISOR));

  // 3. day_preference_profile[24] — ZEROED (Item 3B1): LinUCB no longer sees
  // the preference matrix as an input feature. The 24 slots stay in the
  // vector (d stays 46 — no BanditArmState/SlotProposal migration) but are
  // permanently 0, so they can never contribute to θ̂ᵀx and never receive
  // gradient from a reward update (an always-zero xᵢ means every ridge-
  // regression update leaves that θᵢ at its prior, forever). This is
  // behaviorally equivalent to "LinUCB doesn't learn from this feature,"
  // implemented as a one-line, migration-free change instead of a dimension
  // change (ADR-0001 §5.1/§5.2's `day_preference_profile[24]` row).
  for (let hour = 0; hour < 24; hour++) {
    vec.push(0);
  }

  // 4. day_of_week[7] one-hot, ISO weekday (Mon → index 0).
  for (let wd = 1; wd <= 7; wd++) {
    vec.push(wd === input.candidateIsoWeekday ? 1 : 0);
  }

  // 5. candidate_days_from_now
  vec.push(minMaxSigned(input.candidateDaysFromNow, MAX_SCAN_DAYS));

  // 6. workload_by_type[10] — {hours, count} per type, fixed order.
  for (const type of WORKLOAD_TYPES) {
    const w = input.workloadByType[type] ?? { hours: 0, count: 0 };
    vec.push(clamp(w.hours / WORKLOAD_HOURS_DIVISOR, 0, 1));
    vec.push(clamp(w.count / WORKLOAD_COUNT_DIVISOR, 0, 1));
  }

  // 7. semester_phase — null → 0 (neutral); otherwise value·2 − 1.
  vec.push(
    input.semesterPhase == null ? 0 : clamp(input.semesterPhase, 0, 1) * 2 - 1,
  );

  // 8. bias
  vec.push(1);

  if (vec.length !== FEATURE_DIM) {
    throw new Error(
      `buildContextVector: produced ${vec.length} features, expected ${FEATURE_DIM}`,
    );
  }
  return vec;
}
