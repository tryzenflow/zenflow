import {
  defaultPreferenceMatrix,
  effectivePreferenceMatrix,
  HeuristicSession,
  matrixIndex,
  optimize,
  sortEDF,
} from "./heuristic";
import { Interval } from "./utils/slot";

const TZ = "UTC";
// 2026-06-15T00:00:00Z is a Monday (isoWeekday 1).
const MONDAY = "2026-06-15";
const NOW = new Date(`${MONDAY}T06:00:00.000Z`);

function session(
  overrides: Partial<HeuristicSession> & { id: string; deadline: Date },
): HeuristicSession {
  return {
    durationMinutes: 60,
    scheduledStartTime: null,
    ...overrides,
  };
}

/** All-zero matrix except one flagged cell, so preference is unambiguous. */
function matrixWithPeak(
  isoWeekdayNum: number,
  hour: number,
  value = 1,
): number[] {
  const matrix = new Array<number>(168).fill(0);
  matrix[matrixIndex(isoWeekdayNum, hour)] = value;
  return matrix;
}

describe("sortEDF — ascending urgency, id tiebreak", () => {
  it("sorts ascending by minutes-from-now-to-deadline", () => {
    const soon = session({
      id: "soon",
      deadline: new Date(`${MONDAY}T12:00:00.000Z`),
    }); // ~6h
    const later = session({
      id: "later",
      deadline: new Date("2026-06-20T06:00:00.000Z"),
    }); // 5 days
    const ranked = sortEDF([later, soon], NOW);
    expect(ranked.map((s) => s.id)).toEqual(["soon", "later"]);
  });

  it("breaks an exact deadline tie using id (localeCompare), no preference involved", () => {
    const deadline = new Date("2026-06-20T06:00:00.000Z");
    const b = session({ id: "b", deadline });
    const a = session({ id: "a", deadline });
    const ranked = sortEDF([b, a], NOW);
    expect(ranked.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("does not mutate the input array", () => {
    const deadline = new Date("2026-06-20T06:00:00.000Z");
    const list = [
      session({ id: "b", deadline }),
      session({ id: "a", deadline }),
    ];
    const original = [...list];
    sortEDF(list, NOW);
    expect(list).toEqual(original);
  });
});

describe("default preference-matrix fallback", () => {
  it("is used whenever the stored matrix length doesn't match PREFERENCE_MATRIX_LENGTH", () => {
    expect(effectivePreferenceMatrix([])).toEqual(defaultPreferenceMatrix());
    expect(effectivePreferenceMatrix([0.5])).toEqual(defaultPreferenceMatrix());
  });

  it("is NOT used when the stored matrix is well-formed (168 cells), even if all zero", () => {
    const zeroed = new Array<number>(168).fill(0);
    expect(effectivePreferenceMatrix(zeroed)).toBe(zeroed);
  });

  it("populates morning (8-11AM)=1, afternoon (2-5PM)=0.5, evening (7-10PM)=0.2, rest=0", () => {
    // NOTE: the JSDoc on `defaultPreferenceMatrix` describes the evening
    // window as "6-10PM", but the implementation's loop is `for (let hour =
    // 19; hour < 22; ...)`, i.e. hours 19-21 (7-10PM), not 18-21. That
    // doc/code mismatch is pre-existing and out of scope for this change
    // (only the `bestFreeSlot` hour-bucket and deadline-rounding bugs were
    // in scope) — this test asserts the actual runtime behavior.
    const matrix = defaultPreferenceMatrix();
    for (let wd = 1; wd <= 7; wd++) {
      expect(matrix[matrixIndex(wd, 8)]).toBe(1);
      expect(matrix[matrixIndex(wd, 9)]).toBe(1);
      expect(matrix[matrixIndex(wd, 10)]).toBe(1);
      expect(matrix[matrixIndex(wd, 11)]).toBe(0); // just past the morning window

      expect(matrix[matrixIndex(wd, 14)]).toBe(0.5);
      expect(matrix[matrixIndex(wd, 16)]).toBe(0.5);
      expect(matrix[matrixIndex(wd, 17)]).toBe(0); // just past the afternoon window

      expect(matrix[matrixIndex(wd, 18)]).toBe(0); // just before the evening window
      expect(matrix[matrixIndex(wd, 19)]).toBe(0.2);
      expect(matrix[matrixIndex(wd, 21)]).toBe(0.2);
      expect(matrix[matrixIndex(wd, 22)]).toBe(0); // just past the evening window

      expect(matrix[matrixIndex(wd, 0)]).toBe(0);
      expect(matrix[matrixIndex(wd, 12)]).toBe(0);
    }
    expect(matrix).toHaveLength(168);
  });
});

describe("optimize — end to end placement", () => {
  it("places the most urgent session first, into its highest-preference free slot", () => {
    const matrix = matrixWithPeak(1, 9, 1); // everyone wants Monday 09:00
    const windowStart = new Date(`${MONDAY}T08:00:00.000Z`);
    const windowEnd = new Date(`${MONDAY}T12:00:00.000Z`);
    const urgent = session({
      id: "urgent",
      durationMinutes: 60,
      deadline: new Date(`${MONDAY}T12:00:00.000Z`),
    });
    const relaxed = session({
      id: "relaxed",
      durationMinutes: 60,
      deadline: new Date("2026-06-25T06:00:00.000Z"),
    });
    const placements = optimize(
      [relaxed, urgent],
      [],
      NOW,
      windowStart,
      windowEnd,
      matrix,
      TZ,
    );

    expect(placements).toHaveLength(2);
    const byId = new Map(placements.map((p) => [p.id, p]));
    expect(byId.get("urgent")!.scheduledStartTime.toISOString()).toBe(
      `${MONDAY}T09:00:00.000Z`,
    );
    // Second session can't reuse 09:00-10:00 — must land elsewhere in-window.
    expect(byId.get("relaxed")!.scheduledStartTime.toISOString()).not.toBe(
      `${MONDAY}T09:00:00.000Z`,
    );
  });

  it("avoids an interval already occupied by another placed/fixed session", () => {
    const matrix = matrixWithPeak(1, 9, 1); // peak at 09:00
    const windowStart = new Date(`${MONDAY}T08:00:00.000Z`);
    const windowEnd = new Date(`${MONDAY}T11:00:00.000Z`);
    const occupied: Interval[] = [
      {
        start: new Date(`${MONDAY}T09:00:00.000Z`).getTime(),
        end: new Date(`${MONDAY}T10:00:00.000Z`).getTime(),
      },
    ];
    const only = session({
      id: "only",
      durationMinutes: 60,
      deadline: new Date(`${MONDAY}T11:00:00.000Z`),
    });
    const placements = optimize(
      [only],
      occupied,
      NOW,
      windowStart,
      windowEnd,
      matrix,
      TZ,
    );

    expect(placements).toHaveLength(1);
    // The preferred 09:00 slot is occupied; earliest free slot wins the tie
    // among the remaining zero-score candidates.
    expect(placements[0].scheduledStartTime.toISOString()).not.toBe(
      `${MONDAY}T09:00:00.000Z`,
    );
    expect(placements[0].scheduledStartTime.toISOString()).toBe(
      `${MONDAY}T08:00:00.000Z`,
    );
  });

  it("skips (does not error on) a session that has nowhere free to fit", () => {
    const windowStart = new Date(`${MONDAY}T08:00:00.000Z`);
    const windowEnd = new Date(`${MONDAY}T09:00:00.000Z`); // only 1h of room
    // Both share a deadline at windowEnd — only one 60-minute session can
    // possibly fit in the 1-hour window; the second must be skipped.
    const a = session({ id: "a", durationMinutes: 60, deadline: windowEnd });
    const b = session({ id: "b", durationMinutes: 60, deadline: windowEnd });
    const placements = optimize(
      [a, b],
      [],
      NOW,
      windowStart,
      windowEnd,
      [],
      TZ,
    );
    expect(placements).toHaveLength(1);
  });

  it("earliest start wins when preference scores tie", () => {
    const windowStart = new Date(`${MONDAY}T08:00:00.000Z`);
    const windowEnd = new Date(`${MONDAY}T10:00:00.000Z`);
    // All-zero matrix -> every candidate ties at score 0.
    const only = session({
      id: "only",
      durationMinutes: 30,
      deadline: windowEnd,
    });
    const placements = optimize(
      [only],
      [],
      NOW,
      windowStart,
      windowEnd,
      [],
      TZ,
    );
    expect(placements[0].scheduledStartTime.toISOString()).toBe(
      `${MONDAY}T08:00:00.000Z`,
    );
  });
});

describe("regression — hour-bucket double-scoring bug (bestFreeSlot loop bound)", () => {
  it("an hour-aligned 60-minute session is scored only on its own start-hour bucket, not the following hour", () => {
    // 09:00 bucket is strongly preferred; 10:00 bucket is strongly disfavored.
    // A 09:00-10:00 candidate must be scored using ONLY the 09:00 bucket — if
    // the buggy `<=` loop bound leaked the 10:00 bucket's score in, the
    // negative 10:00 score would drag 09:00 below a neutral candidate.
    const matrix = new Array<number>(168).fill(0);
    matrix[matrixIndex(1, 9)] = 10; // Monday 09:00 — highly preferred
    matrix[matrixIndex(1, 10)] = -10; // Monday 10:00 — highly disfavored
    matrix[matrixIndex(1, 12)] = 1; // Monday 12:00 — mildly preferred, no adjacency issue

    const windowStart = new Date(`${MONDAY}T09:00:00.000Z`);
    const windowEnd = new Date(`${MONDAY}T13:00:00.000Z`);
    const only = session({
      id: "only",
      durationMinutes: 60,
      deadline: windowEnd,
    });
    const placements = optimize(
      [only],
      [],
      NOW,
      windowStart,
      windowEnd,
      matrix,
      TZ,
    );

    // 09:00 scores 10 (its own bucket only); 12:00 scores 1. 09:00 must win.
    expect(placements[0].scheduledStartTime.toISOString()).toBe(
      `${MONDAY}T09:00:00.000Z`,
    );
  });
});

describe("regression — non-slot-aligned deadline must never be overshot", () => {
  it("never places a session such that start + duration exceeds the exact deadline instant", () => {
    // Deadline is 47 minutes past the hour — not 15-minute-aligned. The 10:00
    // hour bucket is strongly preferred; only its LAST 15-minute-aligned slot
    // (10:45-11:00) is free (10:00/10:15/10:30 are occupied by another
    // session). That slot's end (11:00) is after the real 10:47 deadline, so
    // it must be rejected even though it's the highest-scoring candidate —
    // a `ceilToSlot`-rounded window (the old bug) would wrongly accept it
    // since ceil(10:47) = 11:00. The fix (`floorToSlot`) correctly excludes
    // it, forcing placement into the lower-scoring but deadline-safe 09:00
    // hour instead.
    const deadline = new Date(`${MONDAY}T10:47:00.000Z`);
    const windowStart = new Date(`${MONDAY}T09:00:00.000Z`);
    const matrix = matrixWithPeak(1, 10, 5); // Monday 10:00 hour strongly preferred
    const occupied: Interval[] = [
      {
        start: new Date(`${MONDAY}T10:00:00.000Z`).getTime(),
        end: new Date(`${MONDAY}T10:45:00.000Z`).getTime(),
      },
    ];
    const only = session({
      id: "only",
      durationMinutes: 15,
      deadline,
    });
    const placements = optimize(
      [only],
      occupied,
      NOW,
      windowStart,
      deadline,
      matrix,
      TZ,
    );

    expect(placements).toHaveLength(1);
    const { scheduledStartTime } = placements[0];
    const end = scheduledStartTime.getTime() + 15 * 60_000;
    expect(end).toBeLessThanOrEqual(deadline.getTime());
    // The tempting-but-invalid 10:45 slot must be rejected...
    expect(scheduledStartTime.toISOString()).not.toBe(
      `${MONDAY}T10:45:00.000Z`,
    );
    // ...falling back to the earliest deadline-safe (zero-score) slot instead.
    expect(scheduledStartTime.toISOString()).toBe(`${MONDAY}T09:00:00.000Z`);
  });

  it("skips a session that cannot fit before a non-aligned deadline at all", () => {
    // Only 14 minutes remain before the deadline from the nearest aligned
    // start — not enough for any 15-minute-granular duration.
    const windowStart = new Date(`${MONDAY}T10:30:00.000Z`);
    const deadline = new Date(`${MONDAY}T10:44:00.000Z`);
    const only = session({
      id: "only",
      durationMinutes: 15,
      deadline,
    });
    const placements = optimize([only], [], NOW, windowStart, deadline, [], TZ);
    expect(placements).toHaveLength(0);
  });
});
