import { PREFERENCE_MATRIX_LENGTH } from "@zenflow/shared";
import { Prisma } from "../../../generated/prisma";
import { intervalOf } from "./place";
import type { EdfTask } from "../interfaces";
import { preferenceIndex, type Interval } from "./slot";
import { PREFERENCE_LEARNING_RATE } from "../constants";

/**
 * Shared, PURE telemetry builders (no I/O). These encode the exact event-snapshot
 * shape, the signed `preferenceMatrix` math, and the pairwise overlap check
 * behind the scheduler's bounded conflict recheck (`SchedulerService.
 * markConflicts`, which does the actual indexed range query). They live here
 * — not buried in `SchedulerService` — so BOTH the production services AND
 * the batched simulator produce byte-identical telemetry from a single
 * source of truth (the simulator computes a year of events in memory, then
 * bulk-writes them, so it cannot call the per-row service path). Keeping
 * them pure also keeps them trivially testable.
 */

/**
 * Reward score written on each TaskEvent type (the Phase-3 signal). COMPLETE/KEEP
 * are the positive placement signal (+1), ABANDON the strongest negative (−1),
 * and MOVE/RESIZE are neutral overrides (0). RESCHEDULED is an auto-placement —
 * same "outcome pending" placeholder as CREATE (+1) — the real preference signal
 * still arrives later via that task's own KEEP/MOVE/COMPLETE/ABANDON. Single
 * source of truth for both the services and the simulator.
 */
export const EVENT_REWARD = {
  CREATE: 1.0,
  MOVE: 0.0,
  RESIZE: 0.0,
  KEEP: 1.0,
  COMPLETE: 1.0,
  ABANDON: -1.0,
  RESCHEDULED: 1.0,
} as const;

/** The DB-row fields the EDF mapping reads (satisfied by a Prisma `Task`). */
export interface EdfSourceTask {
  id: string;
  durationMinutes: number;
  deadline: Date | null;
  manuallyMoved: boolean;
  scheduledStartTime: Date | null;
  createdAt: Date;
  conflict: boolean;
}

/**
 * Map a task row to the pure-core {@link EdfTask}. A thin, direct mapping now
 * that fixed tasks and the per-task creation-day anchor/period-ceiling are
 * gone (see docs/heuristic.md) — kept as a named function (rather than inlined
 * at call sites) so the service and the batched simulator build the exact same
 * shape from a single source of truth.
 */
export function toEdfTask(task: EdfSourceTask): EdfTask {
  return {
    id: task.id,
    durationMinutes: task.durationMinutes,
    deadline: task.deadline,
    manuallyMoved: task.manuallyMoved,
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
 *
 * `propensity` (optional) is the stochastic logging policy's first-choice
 * probability for the slot it actually suggested — `π(chosen slot | feasible
 * set)` under the Phase-2 softmax re-ranker. It is recorded on the
 * auto-placement / CREATE event so off-policy IPS/SNIPS can divide by the TRUE
 * propensity of the logged decision instead of a hand-rolled floor
 * (docs/heuristic.md §Evaluation). Stored in the snapshot JSON
 * (`Prisma.InputJsonValue`) — no Prisma migration, no shared-type change. Omitted
 * entirely when undefined (Phase-1 / cold-start callers that don't compute it).
 */
export function buildSnapshot(
  task: SnapshotTask,
  tags: string[] = [],
  suggestedStartTime?: Date | null,
  propensity?: number,
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
    // The policy's first-choice propensity for the suggested slot (IPS). Omitted
    // when the caller didn't compute it (Phase-1 / cold-start paths).
    ...(propensity !== undefined ? { propensity } : {}),
  };
}

/**
 * Apply signed `{ at, delta }` entries to a COPY of `matrix` and return it. A
 * positive delta marks a liked/kept block (move-toward / accepted), a negative
 * delta a disliked block (move-away). The matrix is seeded to all-zero when it
 * isn't the expected length, and out-of-range indices are skipped. Pure — the
 * caller persists the result.
 *
 * Each event contributes `PREFERENCE_LEARNING_RATE × delta` rather than a raw
 * `±1`, so a single action nudges the weight instead of spiking it. At the
 * default η=0.1, ten consecutive COMPLETE events in the same bucket converge
 * to +1.0 — the same theoretical ceiling as before, reached gradually. The
 * existing exponential time-decay in `matrix-decay.ts` (half-life 21 days)
 * erodes stale values on the nightly cron schedule independently of this step.
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
    if (idx >= 0 && idx < PREFERENCE_MATRIX_LENGTH)
      out[idx] += PREFERENCE_LEARNING_RATE * delta;
  }
  return out;
}

/** The minimal task shape a bounded conflict recheck reasons over. */
export interface ConflictNeighbor {
  id: string;
  scheduledStartTime: Date | null;
  durationMinutes: number;
  conflict: boolean;
}

/** True when two intervals share any overlap (half-open, `[start, end)`). */
function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * Pure pairwise overlap check: does `interval` clash with any of `neighbors`'
 * OWN intervals? `null` (unplaced) never overlaps anything. This is the pure
 * core of `SchedulerService.markConflicts` — a BOUNDED conflict recheck
 * scoped to a single task's just-written/just-vacated interval, replacing the
 * old `recomputeConflicts` global O(n²) pairwise scan over the whole pending
 * backlog (confirmed unoptimized — see the redesign's Reality Check). The
 * service is the one that fetches `neighbors` via a single indexed range
 * query (`@@index([userId, scheduledStartTime])`) around the interval(s) in
 * question — this function never scans the whole backlog itself, and does no
 * I/O of its own.
 */
export function overlapsAnyTask(
  interval: Interval | null,
  neighbors: ConflictNeighbor[],
): boolean {
  if (!interval) return false;
  return neighbors.some((n) => {
    const iv = intervalOf(n);
    return iv ? overlaps(interval, iv) : false;
  });
}
