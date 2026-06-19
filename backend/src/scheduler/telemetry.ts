import { PREFERENCE_MATRIX_LENGTH, type ViewMode } from "@zenflow/shared";
import { Prisma } from "../../generated/prisma";
import { intervalOf, type EdfTask, type SchedulerPrefs } from "./edf";
import { preferenceIndex, type Interval } from "./slot";
import { endOfPeriod } from "./horizon";

/**
 * Shared, PURE telemetry builders (no I/O). These encode the exact event-snapshot
 * shape, the signed `preferenceMatrix` math, and the pairwise conflict recompute
 * that the scheduler writes on every mutation. They live here — not buried in
 * `SchedulerService` — so BOTH the production services AND the batched simulator
 * produce byte-identical telemetry from a single source of truth (the simulator
 * computes a year of events in memory, then bulk-writes them, so it cannot call
 * the per-row service path). Keeping them pure also keeps them trivially testable.
 */

/**
 * Reward score written on each TaskEvent type (the Phase-3 signal). COMPLETE/KEEP
 * are the positive placement signal (+1), ABANDON the strongest negative (−1),
 * and MOVE/RESIZE are neutral overrides (0). Single source of truth for both the
 * services and the simulator.
 */
export const EVENT_REWARD = {
  CREATE: 1.0,
  MOVE: 0.0,
  RESIZE: 0.0,
  KEEP: 1.0,
  COMPLETE: 1.0,
  ABANDON: -1.0,
} as const;

/** The DB-row fields the EDF mapping reads (satisfied by a Prisma `Task`). */
export interface EdfSourceTask {
  id: string;
  durationMinutes: number;
  deadline: Date | null;
  fixed: boolean;
  manuallyMoved: boolean;
  schedulingAnchor: Date | null;
  view: ViewMode | null;
  scheduledStartTime: Date | null;
  createdAt: Date;
  conflict: boolean;
}

/**
 * Map a task row to the pure-core {@link EdfTask}, deriving the period CEILING
 * (`schedulingDeadline`). The ceiling applies ONLY to a flexible task with no
 * user `deadline` that carries a stored `view` + `schedulingAnchor`: it is bound
 * to the working hours of the day/week/month it was created in and must not roll
 * past that period's end (in `prefs.timezone`). Everything else is unbounded
 * (`null`). Shared so the service and the batched simulator place identically.
 */
export function toEdfTask(task: EdfSourceTask, prefs: SchedulerPrefs): EdfTask {
  const schedulingDeadline =
    !task.fixed &&
    task.deadline === null &&
    task.view !== null &&
    task.schedulingAnchor !== null
      ? endOfPeriod(task.schedulingAnchor, task.view, prefs.timezone, {
          workStart: prefs.workStart,
          workEnd: prefs.workEnd,
        })
      : null;
  return {
    id: task.id,
    durationMinutes: task.durationMinutes,
    deadline: task.deadline,
    fixed: task.fixed,
    manuallyMoved: task.manuallyMoved,
    schedulingAnchor: task.schedulingAnchor,
    schedulingDeadline,
    scheduledStartTime: task.scheduledStartTime,
    createdAt: task.createdAt,
    conflict: task.conflict,
  };
}

/** The minimal task shape a snapshot records. */
export interface SnapshotTask {
  scheduledStartTime: Date | null;
  durationMinutes: number;
}

/**
 * Build a {@link TaskSnapshot} for a TaskEvent: the slot + duration, the task's
 * tag NAMES at event time, and — on MOVE/RESIZE — the EDF-suggested slot the user
 * overrode (`suggestedStartTime`, omitted entirely for CREATE/KEEP/COMPLETE/etc.).
 */
export function buildSnapshot(
  task: SnapshotTask,
  tags: string[] = [],
  suggestedStartTime?: Date | null,
): Prisma.InputJsonValue {
  return {
    scheduledStartTime: task.scheduledStartTime
      ? task.scheduledStartTime.toISOString()
      : null,
    durationMinutes: task.durationMinutes,
    tags,
    // Only MOVE/RESIZE pass a suggested slot; others omit the key.
    ...(suggestedStartTime !== undefined
      ? {
          suggestedStartTime: suggestedStartTime
            ? suggestedStartTime.toISOString()
            : null,
        }
      : {}),
  };
}

/**
 * Apply signed `{ at, delta }` entries to a COPY of `matrix` and return it. A
 * positive delta marks a liked/kept block (move-toward / accepted), a negative
 * delta a disliked block (move-away). The matrix is seeded to all-zero when it
 * isn't the expected length, and out-of-range indices are skipped. Pure — the
 * caller persists the result.
 */
export function applyPreferenceDeltas(
  matrix: readonly number[],
  deltas: { at: Date; delta: number }[],
  timezone: string,
): number[] {
  const out =
    matrix.length === PREFERENCE_MATRIX_LENGTH
      ? [...matrix]
      : new Array<number>(PREFERENCE_MATRIX_LENGTH).fill(0);
  for (const { at, delta } of deltas) {
    const idx = preferenceIndex(at, timezone);
    if (idx >= 0 && idx < PREFERENCE_MATRIX_LENGTH) out[idx] += delta;
  }
  return out;
}

/** The minimal task shape the conflict recompute reasons over. */
export interface ConflictTask {
  id: string;
  scheduledStartTime: Date | null;
  durationMinutes: number;
  conflict: boolean;
}

/**
 * Recompute each task's conflict flag from pure pairwise time-overlap across the
 * `projected` set: a placed task clashes if it overlaps any other placed task,
 * anywhere in the window. Now-INDEPENDENT — elapsed/in-progress/past tasks all
 * participate. Unplaced tasks keep their incoming verdict.
 */
export function recomputeConflicts(
  projected: ConflictTask[],
): Map<string, boolean> {
  const overlaps = (a: Interval, b: Interval) =>
    a.start < b.end && b.start < a.end;
  const conflictOf = new Map<string, boolean>();
  for (const t of projected) {
    const iv = intervalOf(t);
    if (!iv) {
      conflictOf.set(t.id, t.conflict); // unplaced — keep verdict
      continue;
    }
    conflictOf.set(
      t.id,
      projected.some((o) => {
        if (o.id === t.id) return false;
        const oiv = intervalOf(o);
        return oiv ? overlaps(iv, oiv) : false;
      }),
    );
  }
  return conflictOf;
}
