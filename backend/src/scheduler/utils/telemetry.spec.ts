import { PREFERENCE_MATRIX_LENGTH } from "@zenflow/shared";
import {
  applyPreferenceDeltas,
  EVENT_REWARD,
  overlapsAnyTask,
  type ConflictNeighbor,
} from "./telemetry";
import { PREFERENCE_LEARNING_RATE } from "../constants";

/**
 * Unit tests for the PURE `applyPreferenceDeltas` helper in telemetry.ts.
 *
 * These tests focus on the per-update learning-rate behaviour introduced in
 * Phase 2: each event moves a cell by `η × delta` (not a raw ±1), which makes
 * the matrix accumulate signal gradually instead of spiking on a single action.
 * The decay half-life (matrix-decay.ts) is orthogonal and tested separately.
 */

/** UTC timestamps that resolve to a known weekday + hour bucket in UTC. */
// Monday 2026-06-22 09:00 UTC  →  isoWeekday=1, day=0, hour 9  →  idx = 0*24 + 9 = 9
const MON_09 = new Date("2026-06-22T09:00:00.000Z");
// Monday 2026-06-22 14:00 UTC  →  isoWeekday=1, day=0, hour 14 →  idx = 0*24 + 14 = 14
const MON_14 = new Date("2026-06-22T14:00:00.000Z");

const TZ = "UTC";

function zeroMatrix(): number[] {
  return new Array<number>(PREFERENCE_MATRIX_LENGTH).fill(0);
}

describe("PREFERENCE_LEARNING_RATE constant", () => {
  it("is 0.1", () => {
    expect(PREFERENCE_LEARNING_RATE).toBe(0.1);
  });
});

describe("applyPreferenceDeltas — learning rate", () => {
  it("applies η × delta (not raw delta) for a COMPLETE signal", () => {
    const out = applyPreferenceDeltas(
      zeroMatrix(),
      [{ at: MON_09, delta: EVENT_REWARD.COMPLETE }],
      TZ,
    );
    // COMPLETE reward is +1; with η=0.1 the cell should move by +0.1
    const idx = 0 * 24 + 9; // day 1, hour 9 in UTC
    expect(out[idx]).toBeCloseTo(
      PREFERENCE_LEARNING_RATE * EVENT_REWARD.COMPLETE,
    );
    // All other cells must remain 0
    expect(out.filter((_, i) => i !== idx).every((v) => v === 0)).toBe(true);
  });

  it("applies η × delta for an ABANDON signal (negative nudge)", () => {
    const out = applyPreferenceDeltas(
      zeroMatrix(),
      [{ at: MON_09, delta: EVENT_REWARD.ABANDON }],
      TZ,
    );
    const idx = 0 * 24 + 9;
    expect(out[idx]).toBeCloseTo(
      PREFERENCE_LEARNING_RATE * EVENT_REWARD.ABANDON,
    );
  });

  it("accumulates gradually: 10 COMPLETE events converge to +1.0", () => {
    let matrix: readonly number[] = zeroMatrix();
    const deltas = Array.from({ length: 10 }, () => ({
      at: MON_09,
      delta: EVENT_REWARD.COMPLETE,
    }));
    matrix = applyPreferenceDeltas(matrix, deltas, TZ);
    const idx = 0 * 24 + 9;
    expect(matrix[idx]).toBeCloseTo(1.0);
  });

  it("handles multiple deltas in a single call across different slots", () => {
    const out = applyPreferenceDeltas(
      zeroMatrix(),
      [
        { at: MON_09, delta: EVENT_REWARD.COMPLETE },
        { at: MON_14, delta: EVENT_REWARD.ABANDON },
      ],
      TZ,
    );
    const idxA = 0 * 24 + 9;
    const idxB = 0 * 24 + 14;
    expect(out[idxA]).toBeCloseTo(
      PREFERENCE_LEARNING_RATE * EVENT_REWARD.COMPLETE,
    );
    expect(out[idxB]).toBeCloseTo(
      PREFERENCE_LEARNING_RATE * EVENT_REWARD.ABANDON,
    );
  });

  it("never mutates the input matrix", () => {
    const input = zeroMatrix();
    applyPreferenceDeltas(input, [{ at: MON_09, delta: 1 }], TZ);
    expect(input.every((v) => v === 0)).toBe(true);
  });

  it("seeds a fresh zero matrix when the input length is wrong", () => {
    const out = applyPreferenceDeltas(
      [1, 2, 3], // wrong length
      [{ at: MON_09, delta: EVENT_REWARD.COMPLETE }],
      TZ,
    );
    expect(out).toHaveLength(PREFERENCE_MATRIX_LENGTH);
    const idx = 0 * 24 + 9;
    expect(out[idx]).toBeCloseTo(PREFERENCE_LEARNING_RATE);
    // Only the touched cell is non-zero
    expect(out.filter((_, i) => i !== idx).every((v) => v === 0)).toBe(true);
  });

  it("leaves MOVE events as zero-delta (reward 0.0 × η = 0)", () => {
    const out = applyPreferenceDeltas(
      zeroMatrix(),
      [{ at: MON_09, delta: EVENT_REWARD.MOVE }],
      TZ,
    );
    expect(out.every((v) => v === 0)).toBe(true);
  });

  it("returns a copy when the delta list is empty", () => {
    const input = zeroMatrix();
    input[0] = 0.5;
    const out = applyPreferenceDeltas(input, [], TZ);
    expect(out).not.toBe(input);
    expect(out[0]).toBe(0.5);
  });
});

/**
 * `overlapsAnyTask` — the pure core of `SchedulerService.markConflicts`'s
 * bounded conflict recheck (replaces the deleted `recomputeConflicts` global
 * O(n²) scan). It only ever reasons over whatever `neighbors` the CALLER
 * already fetched via a single indexed range query — never a global scan.
 */
describe("overlapsAnyTask", () => {
  function neighbor(
    overrides: Partial<ConflictNeighbor> & { id: string },
  ): ConflictNeighbor {
    return {
      scheduledStartTime: null,
      durationMinutes: 60,
      conflict: false,
      ...overrides,
    };
  }

  it("is false for a null interval (unplaced/removed task never conflicts)", () => {
    const n = neighbor({
      id: "b",
      scheduledStartTime: new Date("2026-06-08T09:00:00Z"),
    });
    expect(overlapsAnyTask(null, [n])).toBe(false);
  });

  it("is false when neighbors is empty", () => {
    const interval = {
      start: new Date("2026-06-08T09:00:00Z").getTime(),
      end: new Date("2026-06-08T10:00:00Z").getTime(),
    };
    expect(overlapsAnyTask(interval, [])).toBe(false);
  });

  it("is false when no neighbor's own interval overlaps", () => {
    const interval = {
      start: new Date("2026-06-08T09:00:00Z").getTime(),
      end: new Date("2026-06-08T10:00:00Z").getTime(),
    };
    const n = neighbor({
      id: "b",
      scheduledStartTime: new Date("2026-06-08T10:00:00Z"), // adjacent, not overlapping
      durationMinutes: 60,
    });
    expect(overlapsAnyTask(interval, [n])).toBe(false);
  });

  it("is true when a neighbor's interval overlaps", () => {
    const interval = {
      start: new Date("2026-06-08T09:00:00Z").getTime(),
      end: new Date("2026-06-08T10:00:00Z").getTime(),
    };
    const n = neighbor({
      id: "b",
      scheduledStartTime: new Date("2026-06-08T09:30:00Z"),
      durationMinutes: 60,
    });
    expect(overlapsAnyTask(interval, [n])).toBe(true);
  });

  it("ignores a neighbor that is itself unplaced", () => {
    const interval = {
      start: new Date("2026-06-08T09:00:00Z").getTime(),
      end: new Date("2026-06-08T10:00:00Z").getTime(),
    };
    const n = neighbor({ id: "b", scheduledStartTime: null });
    expect(overlapsAnyTask(interval, [n])).toBe(false);
  });
});
