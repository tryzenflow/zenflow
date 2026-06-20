import { PREFERENCE_MATRIX_LENGTH } from "@zenflow/shared";
import {
  identityReRanker,
  preferenceMatrixReRanker,
  type SlotReRanker,
} from "./reranker";
import type { EdfTask } from "./interfaces";
import { preferenceIndex } from "./slot";

/**
 * Phase-2 placement re-ranker (ADR-0001 §1). The two load-bearing guarantees the
 * spec mandates: the output is a pure PERMUTATION of the input (same multiset,
 * nothing added/dropped), and an empty / cold-start matrix degenerates to
 * IDENTITY. Plus: it reorders by descending cell score, ties break on the
 * original EDF time order, and the grid math matches the production
 * {@link preferenceIndex}.
 */

const TZ = "UTC";

function task(durationMinutes = 60): EdfTask {
  return {
    id: "t1",
    durationMinutes,
    deadline: null,
    fixed: false,
    manuallyMoved: false,
    schedulingAnchor: null,
    schedulingDeadline: null,
    scheduledStartTime: null,
    createdAt: new Date(0),
    conflict: false,
  };
}

/** A fresh all-zero 672-cell matrix. */
function zeroMatrix(): number[] {
  return new Array<number>(PREFERENCE_MATRIX_LENGTH).fill(0);
}

/** Sorted epoch-ms multiset of a candidate list, for permutation comparison. */
function multiset(dates: Date[]): number[] {
  return dates.map((d) => d.getTime()).sort((a, b) => a - b);
}

// A handful of ascending Monday slots (the order EDF would hand in).
const MONDAY = "2026-06-08T"; // a Monday
const candidates = [
  new Date(`${MONDAY}09:00:00Z`),
  new Date(`${MONDAY}09:15:00Z`),
  new Date(`${MONDAY}09:30:00Z`),
  new Date(`${MONDAY}09:45:00Z`),
  new Date(`${MONDAY}10:00:00Z`),
];

describe("preferenceMatrixReRanker — permutation guarantee", () => {
  it("returns the same multiset as the input (adds nothing, drops nothing)", () => {
    const matrix = zeroMatrix();
    // Sprinkle arbitrary signed scores so the order actually changes.
    matrix[preferenceIndex(candidates[4], TZ)] = 5;
    matrix[preferenceIndex(candidates[1], TZ)] = -3;
    matrix[preferenceIndex(candidates[2], TZ)] = 2;

    const out = preferenceMatrixReRanker(matrix, TZ).score(task(), candidates);

    expect(out).toHaveLength(candidates.length);
    expect(multiset(out)).toEqual(multiset(candidates));
  });

  it("does not mutate the input array", () => {
    const matrix = zeroMatrix();
    matrix[preferenceIndex(candidates[3], TZ)] = 9;
    const input = [...candidates];
    preferenceMatrixReRanker(matrix, TZ).score(task(), input);
    expect(input).toEqual(candidates);
  });

  it("handles empty and single-element candidate lists", () => {
    const r = preferenceMatrixReRanker(zeroMatrix(), TZ);
    expect(r.score(task(), [])).toEqual([]);
    expect(r.score(task(), [candidates[0]])).toEqual([candidates[0]]);
  });
});

describe("preferenceMatrixReRanker — empty / cold-start matrix == identity", () => {
  const expectIdentity = (r: SlotReRanker) => {
    expect(r.score(task(), candidates)).toEqual(candidates);
  };

  it("an all-zero 672-cell matrix preserves EDF order exactly", () => {
    expectIdentity(preferenceMatrixReRanker(zeroMatrix(), TZ));
    // ...byte-for-byte the identity re-ranker.
    expect(
      preferenceMatrixReRanker(zeroMatrix(), TZ).score(task(), candidates),
    ).toEqual(identityReRanker.score(task(), candidates));
  });

  it("an empty (cold-start) matrix preserves EDF order exactly", () => {
    expectIdentity(preferenceMatrixReRanker([], TZ));
  });

  it("a wrong-length matrix is treated as cold-start (identity)", () => {
    expectIdentity(preferenceMatrixReRanker([1, 2, 3], TZ));
  });
});

describe("preferenceMatrixReRanker — ordering", () => {
  it("reorders by DESCENDING cell score, most-preferred first", () => {
    const matrix = zeroMatrix();
    matrix[preferenceIndex(candidates[0], TZ)] = 1;
    matrix[preferenceIndex(candidates[1], TZ)] = 4; // highest
    matrix[preferenceIndex(candidates[2], TZ)] = -2; // lowest
    matrix[preferenceIndex(candidates[3], TZ)] = 3;
    // candidates[4] stays 0

    const out = preferenceMatrixReRanker(matrix, TZ).score(task(), candidates);
    expect(out).toEqual([
      candidates[1], // 4
      candidates[3], // 3
      candidates[0], // 1
      candidates[4], // 0
      candidates[2], // -2
    ]);
  });

  it("breaks ties on the original EDF time order (stable)", () => {
    // Two cells at the top score, two at the bottom — within each tier the
    // earlier EDF slot must come first.
    const matrix = zeroMatrix();
    matrix[preferenceIndex(candidates[0], TZ)] = 2;
    matrix[preferenceIndex(candidates[2], TZ)] = 2;
    matrix[preferenceIndex(candidates[1], TZ)] = -1;
    matrix[preferenceIndex(candidates[4], TZ)] = -1;
    // candidates[3] stays 0 (middle tier)

    const out = preferenceMatrixReRanker(matrix, TZ).score(task(), candidates);
    expect(out).toEqual([
      candidates[0], // +2, earlier
      candidates[2], // +2, later
      candidates[3], // 0
      candidates[1], // -1, earlier
      candidates[4], // -1, later
    ]);
  });

  it("routes a task away from a disliked block toward a liked one", () => {
    // The earliest EDF slot is disliked; a later slot is liked → the later slot
    // wins the top spot, while remaining a permutation.
    const matrix = zeroMatrix();
    matrix[preferenceIndex(candidates[0], TZ)] = -5; // earliest, disliked
    matrix[preferenceIndex(candidates[4], TZ)] = 5; // latest, liked

    const out = preferenceMatrixReRanker(matrix, TZ).score(task(), candidates);
    expect(out[0]).toEqual(candidates[4]);
    expect(out[out.length - 1]).toEqual(candidates[0]);
    expect(multiset(out)).toEqual(multiset(candidates));
  });

  it("honours the user's timezone when reading the cell", () => {
    // 2026-06-08T13:00:00Z is Monday 09:00 in New York; mark that wall-clock cell
    // liked and confirm the NY-09:00 candidate floats to the top.
    const nyCandidates = [
      new Date("2026-06-08T12:00:00Z"), // NY 08:00
      new Date("2026-06-08T13:00:00Z"), // NY 09:00 (liked)
      new Date("2026-06-08T14:00:00Z"), // NY 10:00
    ];
    const matrix = zeroMatrix();
    matrix[preferenceIndex(nyCandidates[1], "America/New_York")] = 7;
    const out = preferenceMatrixReRanker(matrix, "America/New_York").score(
      task(),
      nyCandidates,
    );
    expect(out[0]).toEqual(nyCandidates[1]);
  });
});
