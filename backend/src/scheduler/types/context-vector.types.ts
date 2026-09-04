/**
 * Types + fixed enumerations for the Disjoint-LinUCB context vector
 * (`docs/adr/0001-linucb-model-design.md` §5). The builder itself lives in
 * `context-vector.ts`.
 */

/** Fixed order of the `workload_by_type` block (2 entries — hours, count — each). */
export const WORKLOAD_TYPES = [
  "LECTURE",
  "ASSIGNMENT",
  "EXAM",
  "TASK",
  "DND",
] as const;

export type WorkloadType = (typeof WORKLOAD_TYPES)[number];

export type WorkloadByType = Record<
  WorkloadType,
  { hours: number; count: number }
>;

export function emptyWorkloadByType(): WorkloadByType {
  return {
    LECTURE: { hours: 0, count: 0 },
    ASSIGNMENT: { hours: 0, count: 0 },
    EXAM: { hours: 0, count: 0 },
    TASK: { hours: 0, count: 0 },
    DND: { hours: 0, count: 0 },
  };
}

export interface ContextVectorInput {
  /** Whole days from `now` to the task deadline. */
  remainingDaysUntilDeadline: number;
  /** Task duration in minutes (positive multiple of 15). */
  durationMinutes: number;
  /** The user's stored flat preference matrix (168 cells; falls back if malformed). */
  preferenceMatrix: number[];
  /** ISO weekday of the candidate day: 1 = Mon … 7 = Sun. */
  candidateIsoWeekday: number;
  /** Whole days from today to the candidate day. */
  candidateDaysFromNow: number;
  /** Scheduled hours + session count already placed on the candidate day, per type. */
  workloadByType: WorkloadByType;
  /** Fraction through the academic term, already in `[0, 1]`; `null` when unavailable. */
  semesterPhase: number | null;
}
