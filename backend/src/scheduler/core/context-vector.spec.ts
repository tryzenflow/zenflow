import { FEATURE_DIM } from "@zenflow/shared";
import { buildContextVector } from "./context-vector";
import {
  ContextVectorInput,
  emptyWorkloadByType,
} from "../types/context-vector.types";

function input(over: Partial<ContextVectorInput> = {}): ContextVectorInput {
  return {
    remainingDaysUntilDeadline: 45,
    durationMinutes: 240,
    candidateIsoWeekday: 3, // Wednesday
    candidateDaysFromNow: 0,
    workloadByType: emptyWorkloadByType(),
    semesterPhase: null,
    ...over,
  };
}

describe("buildContextVector", () => {
  it("produces exactly FEATURE_DIM (22) elements", () => {
    expect(buildContextVector(input())).toHaveLength(FEATURE_DIM);
  });

  it("normalizes the continuous features with the ADR §5.2 transforms", () => {
    const v = buildContextVector(
      input({
        remainingDaysUntilDeadline: 30, // 30/MAX_SCAN_DAYS(60) → 0.5 → 0
        durationMinutes: 480, // 480/480 → 1 → 1
        candidateDaysFromNow: 90, // clamp → 1 → 1
      }),
    );
    expect(v[0]).toBeCloseTo(0); // remaining_days_until_deadline
    expect(v[1]).toBeCloseTo(1); // duration
    expect(v[9]).toBeCloseTo(1); // candidate_days_from_now
  });

  it("clamps out-of-range continuous inputs", () => {
    const v = buildContextVector(
      input({ remainingDaysUntilDeadline: 1000, durationMinutes: 0 }),
    );
    expect(v[0]).toBe(1);
    expect(v[1]).toBe(-1);
  });

  it("one-hot encodes the ISO weekday (Mon → index 0) at offset 2", () => {
    const v = buildContextVector(input({ candidateIsoWeekday: 3 }));
    const oneHot = v.slice(2, 9);
    expect(oneHot).toEqual([0, 0, 1, 0, 0, 0, 0]);
  });

  it("normalizes workload_by_type with the TASK entry at offsets 16/17", () => {
    const workloadByType = emptyWorkloadByType();
    workloadByType.TASK = { hours: 6, count: 4 };
    const v = buildContextVector(input({ workloadByType }));
    expect(v[16]).toBeCloseTo(0.5); // 6 / 12
    expect(v[17]).toBeCloseTo(0.5); // 4 / 8
    expect(v[10]).toBe(0); // LECTURE hours
  });

  it("emits 0 for a null semester_phase and value·2−1 otherwise", () => {
    expect(buildContextVector(input({ semesterPhase: null }))[20]).toBe(0);
    expect(buildContextVector(input({ semesterPhase: 0.5 }))[20]).toBeCloseTo(
      0,
    );
    expect(buildContextVector(input({ semesterPhase: 1 }))[20]).toBeCloseTo(1);
  });

  it("ends with the constant bias term", () => {
    expect(buildContextVector(input())[21]).toBe(1);
  });
});
