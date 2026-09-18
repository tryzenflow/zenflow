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
 * (`docs/adr/0001-linucb-model-design.md` §5, `d = 22`).
 *
 * Pure: no I/O, no clock, no randomness. The caller (`BanditScheduleService`)
 * is responsible for computing `remainingDaysUntilDeadline`,
 * `candidateDaysFromNow`, the per-day `workloadByType`, and `semesterPhase`.
 * Types + enumerations live in `context-vector.types.ts`; the normalization
 * transforms in `utils/normalize.ts`.
 *
 * Returns exactly {@link FEATURE_DIM} (22) elements, in the ADR §5.1 order:
 * `remaining_days_until_deadline`, `duration`, `day_of_week[7]`,
 * `candidate_days_from_now`, `workload_by_type[10]`, `semester_phase`, bias.
 *
 * `day_preference_profile[24]` (the reserved, always-zero slots left over
 * from Item 3B1) has been dropped entirely — LinUCB never read it, and no
 * `BanditArmState`/`SlotProposal` row carried a meaningful value there, so
 * this is a plain dimension change (`d`: 46 → 22), not a migration.
 */
export function buildContextVector(input: ContextVectorInput): number[] {
  const vec: number[] = [];

  // 1. remaining_days_until_deadline
  vec.push(minMaxSigned(input.remainingDaysUntilDeadline, MAX_SCAN_DAYS));

  // 2. duration
  vec.push(minMaxSigned(input.durationMinutes, DURATION_DIVISOR));

  // 3. day_of_week[7] one-hot, ISO weekday (Mon → index 0).
  for (let wd = 1; wd <= 7; wd++) {
    vec.push(wd === input.candidateIsoWeekday ? 1 : 0);
  }

  // 4. candidate_days_from_now
  vec.push(minMaxSigned(input.candidateDaysFromNow, MAX_SCAN_DAYS));

  // 5. workload_by_type[10] — {hours, count} per type, fixed order.
  for (const type of WORKLOAD_TYPES) {
    const w = input.workloadByType[type] ?? { hours: 0, count: 0 };
    vec.push(clamp(w.hours / WORKLOAD_HOURS_DIVISOR, 0, 1));
    vec.push(clamp(w.count / WORKLOAD_COUNT_DIVISOR, 0, 1));
  }

  // 6. semester_phase — null → 0 (neutral); otherwise value·2 − 1.
  vec.push(
    input.semesterPhase == null ? 0 : clamp(input.semesterPhase, 0, 1) * 2 - 1,
  );

  // 7. bias
  vec.push(1);

  if (vec.length !== FEATURE_DIM) {
    throw new Error(
      `buildContextVector: produced ${vec.length} features, expected ${FEATURE_DIM}`,
    );
  }
  return vec;
}
