import { PREFERENCE_MATRIX_LENGTH } from "@zenflow/shared";
import {
  identityReRanker,
  preferenceMatrixReRanker,
  type SlotReRanker,
} from "./reranker";
import type { EdfTask } from "./interfaces";
import { preferenceIndex } from "./slot";

/**
 * Phase-2 SOFTMAX placement re-ranker (ADR-0001 §1, docs/heuristic.md §Phase 2).
 * The load-bearing guarantees the spec mandates:
 *  - the output is a pure PERMUTATION of the input (nothing added/dropped);
 *  - an all-equal / cold-start matrix degenerates to IDENTITY earliest-fit
 *    (no random shuffle of a fresh user's tasks);
 *  - `T → 0` recovers the deterministic argmax (today's greedy Phase-2);
 *  - the same task id + seed → the same sampled draw (reproducible, pure);
 *  - a strongly-peaked matrix picks the peak with high probability;
 *  - `propensity` is the closed-form softmax first-choice marginal.
 */

const TZ = "UTC";

function task(id = "t1", durationMinutes = 60): EdfTask {
  return {
    id,
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

/** A fresh all-zero 56-cell matrix. */
function zeroMatrix(): number[] {
  return new Array<number>(PREFERENCE_MATRIX_LENGTH).fill(0);
}

/** Sorted epoch-ms multiset of a candidate list, for permutation comparison. */
function multiset(dates: Date[]): number[] {
  return dates.map((d) => d.getTime()).sort((a, b) => a - b);
}

// A handful of ascending Monday slots, each in a DIFFERENT 3-hour bucket so
// the matrix can assign distinct cell scores (2026-06-08 is a Monday).
// Buckets: 09:00=3, 12:00=4, 15:00=5, 18:00=6, 21:00=7.
const MONDAY = "2026-06-08T"; // a Monday
const candidates = [
  new Date(`${MONDAY}09:00:00Z`), // bucket 3
  new Date(`${MONDAY}12:00:00Z`), // bucket 4
  new Date(`${MONDAY}15:00:00Z`), // bucket 5
  new Date(`${MONDAY}18:00:00Z`), // bucket 6
  new Date(`${MONDAY}21:00:00Z`), // bucket 7
];

describe("preferenceMatrixReRanker — permutation guarantee", () => {
  it("returns the same multiset as the input (adds nothing, drops nothing)", () => {
    const matrix = zeroMatrix();
    matrix[preferenceIndex(candidates[4], TZ)] = 5;
    matrix[preferenceIndex(candidates[1], TZ)] = -3;
    matrix[preferenceIndex(candidates[2], TZ)] = 2;

    // Sweep many seeds: every sampled order must still be a permutation.
    for (let seed = 0; seed < 50; seed++) {
      const out = preferenceMatrixReRanker(matrix, TZ, { seed }).score(
        task(`task-${seed}`),
        candidates,
      );
      expect(out).toHaveLength(candidates.length);
      expect(multiset(out)).toEqual(multiset(candidates));
    }
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

describe("preferenceMatrixReRanker — cold-start / all-equal == identity earliest-fit", () => {
  const expectIdentity = (r: SlotReRanker) => {
    // Across seeds, an all-equal matrix must ALWAYS return EDF order unchanged —
    // never a Gumbel shuffle of a fresh user's tasks.
    for (let seed = 0; seed < 20; seed++) {
      expect(
        preferenceMatrixReRanker([], TZ, { seed }).score(task(), candidates),
      ).toEqual(candidates);
    }
    expect(r.score(task(), candidates)).toEqual(candidates);
  };

  it("an all-zero 56-cell matrix preserves EDF order exactly (byte-for-byte identity)", () => {
    const r = preferenceMatrixReRanker(zeroMatrix(), TZ);
    expect(r.score(task(), candidates)).toEqual(candidates);
    expect(r.score(task(), candidates)).toEqual(
      identityReRanker.score(task(), candidates),
    );
  });

  it("an empty (cold-start) matrix preserves EDF order exactly", () => {
    expectIdentity(preferenceMatrixReRanker([], TZ));
  });

  it("a wrong-length matrix is treated as cold-start (identity)", () => {
    expectIdentity(preferenceMatrixReRanker([1, 2, 3], TZ));
  });

  it("a uniform NON-zero matrix (all cells equal) is also identity earliest-fit", () => {
    // All-equal but non-zero: still no preference SIGNAL between candidates, so
    // we must not shuffle. (Reads as 0 anyway since it's wrong length, but the
    // intent is the all-equal branch.)
    const matrix = new Array<number>(PREFERENCE_MATRIX_LENGTH).fill(3);
    expect(
      preferenceMatrixReRanker(matrix, TZ, { seed: 7 }).score(
        task(),
        candidates,
      ),
    ).toEqual(candidates);
  });
});

describe("preferenceMatrixReRanker — T → 0 recovers deterministic argmax", () => {
  it("at a tiny temperature, picks the highest-cell-score slot first, descending", () => {
    // Each candidate is in a distinct 3-hour bucket so the scores are unambiguous.
    const matrix = zeroMatrix();
    matrix[preferenceIndex(candidates[0], TZ)] = 1; // bucket 3
    matrix[preferenceIndex(candidates[1], TZ)] = 4; // bucket 4, highest
    matrix[preferenceIndex(candidates[2], TZ)] = -2; // bucket 5, lowest
    matrix[preferenceIndex(candidates[3], TZ)] = 3; // bucket 6
    // candidates[4] (bucket 7) stays 0

    // T → 0: the score/T term swamps the O(1) Gumbel noise, so the order is the
    // pure descending-cell-score argmax for ANY seed.
    for (let seed = 0; seed < 20; seed++) {
      const out = preferenceMatrixReRanker(matrix, TZ, {
        temperature: 1e-6,
        seed,
      }).score(task(`task-${seed}`), candidates);
      expect(out).toEqual([
        candidates[1], // 4
        candidates[3], // 3
        candidates[0], // 1
        candidates[4], // 0
        candidates[2], // -2
      ]);
    }
  });

  it("at T → 0, routes a task away from a disliked block toward a liked one", () => {
    const matrix = zeroMatrix();
    matrix[preferenceIndex(candidates[0], TZ)] = -5; // earliest, disliked
    matrix[preferenceIndex(candidates[4], TZ)] = 5; // latest, liked
    const out = preferenceMatrixReRanker(matrix, TZ, {
      temperature: 1e-6,
    }).score(task(), candidates);
    expect(out[0]).toEqual(candidates[4]);
    expect(out[out.length - 1]).toEqual(candidates[0]);
  });
});

describe("preferenceMatrixReRanker — reproducibility (pure of inputs + seed)", () => {
  it("same task id + same seed → identical sampled order", () => {
    const matrix = zeroMatrix();
    matrix[preferenceIndex(candidates[2], TZ)] = 2;
    matrix[preferenceIndex(candidates[4], TZ)] = 1;
    const a = preferenceMatrixReRanker(matrix, TZ, { seed: 42 }).score(
      task("stable"),
      candidates,
    );
    const b = preferenceMatrixReRanker(matrix, TZ, { seed: 42 }).score(
      task("stable"),
      candidates,
    );
    expect(a).toEqual(b);
  });

  it("per-task seed is derived from the task id, NOT from now — re-pack is stable", () => {
    // The same task re-packed (e.g. on an unrelated cascade) must yield the same
    // draw. We model "two cascades" as two independent re-ranker instances with
    // the same base seed scoring the same task id; the result must be identical.
    const matrix = zeroMatrix();
    matrix[preferenceIndex(candidates[1], TZ)] = 3;
    matrix[preferenceIndex(candidates[3], TZ)] = 2;
    const first = preferenceMatrixReRanker(matrix, TZ, { seed: 5 }).score(
      task("churn-guard"),
      candidates,
    );
    const second = preferenceMatrixReRanker(matrix, TZ, { seed: 5 }).score(
      task("churn-guard"),
      candidates,
    );
    expect(second).toEqual(first);
  });

  it("different task ids generally explore differently", () => {
    const matrix = zeroMatrix();
    matrix[preferenceIndex(candidates[2], TZ)] = 1;
    const orders = new Set<string>();
    for (let i = 0; i < 30; i++) {
      const out = preferenceMatrixReRanker(matrix, TZ, { seed: 1 }).score(
        task(`id-${i}`),
        candidates,
      );
      orders.add(out.map((d) => d.getTime()).join(","));
    }
    // With a near-flat matrix and 30 distinct ids we expect more than one order.
    expect(orders.size).toBeGreaterThan(1);
  });
});

describe("preferenceMatrixReRanker — strongly-peaked matrix picks the peak w.h.p.", () => {
  it("over many seeds, a sharp peak wins the top slot the large majority of the time", () => {
    const matrix = zeroMatrix();
    matrix[preferenceIndex(candidates[3], TZ)] = 10; // sharp peak
    let peakFirst = 0;
    const N = 200;
    for (let seed = 0; seed < N; seed++) {
      const out = preferenceMatrixReRanker(matrix, TZ, { seed }).score(
        task(`peak-${seed}`),
        candidates,
      );
      if (out[0].getTime() === candidates[3].getTime()) peakFirst++;
    }
    // softmax(10 vs 0) over 5 slots ⇒ p ≈ e^10/(e^10 + 4) ≈ 0.9998; allow slack.
    expect(peakFirst / N).toBeGreaterThan(0.95);
  });

  it("honours the user's timezone when reading the cell", () => {
    // UTC-4 in June. Use candidates in distinct NY 3-hour buckets:
    // 13:00Z = NY 09:00 (bucket 3, liked), 16:00Z = NY 12:00 (bucket 4), 12:00Z = NY 08:00 (bucket 2).
    const nyCandidates = [
      new Date("2026-06-08T12:00:00Z"), // NY 08:00 (bucket 2)
      new Date("2026-06-08T13:00:00Z"), // NY 09:00 (bucket 3, liked)
      new Date("2026-06-08T16:00:00Z"), // NY 12:00 (bucket 4)
    ];
    const matrix = zeroMatrix();
    matrix[preferenceIndex(nyCandidates[1], "America/New_York")] = 10;
    const out = preferenceMatrixReRanker(matrix, "America/New_York", {
      temperature: 1e-6,
    }).score(task(), nyCandidates);
    expect(out[0]).toEqual(nyCandidates[1]);
  });
});

describe("preferenceMatrixReRanker — propensity (softmax first-choice marginal)", () => {
  it("matches exp(s_chosen/T) / Σ exp(s_j/T)", () => {
    const matrix = zeroMatrix();
    matrix[preferenceIndex(candidates[0], TZ)] = 1;
    matrix[preferenceIndex(candidates[1], TZ)] = 4;
    matrix[preferenceIndex(candidates[2], TZ)] = -2;
    matrix[preferenceIndex(candidates[3], TZ)] = 3;
    const T = 1.0;
    const r = preferenceMatrixReRanker(matrix, TZ, { temperature: T });

    const scores = [1, 4, -2, 3, 0];
    const denom = scores.reduce((a, s) => a + Math.exp(s / T), 0);
    for (let i = 0; i < candidates.length; i++) {
      const expected = Math.exp(scores[i] / T) / denom;
      expect(r.propensity(task(), candidates, candidates[i])).toBeCloseTo(
        expected,
        10,
      );
    }
  });

  it("propensities over the candidate set sum to 1", () => {
    const matrix = zeroMatrix();
    matrix[preferenceIndex(candidates[1], TZ)] = 2;
    matrix[preferenceIndex(candidates[4], TZ)] = -1;
    const r = preferenceMatrixReRanker(matrix, TZ);
    const total = candidates.reduce(
      (a, c) => a + r.propensity(task(), candidates, c),
      0,
    );
    expect(total).toBeCloseTo(1, 10);
  });

  it("cold-start propensity is uniform 1/n", () => {
    const r = preferenceMatrixReRanker([], TZ);
    expect(r.propensity(task(), candidates, candidates[2])).toBeCloseTo(
      1 / candidates.length,
      10,
    );
  });

  it("a slot outside the candidate set has propensity 0", () => {
    const matrix = zeroMatrix();
    matrix[preferenceIndex(candidates[0], TZ)] = 3;
    const r = preferenceMatrixReRanker(matrix, TZ);
    // 06:00 is not in the candidates array (which starts at 09:00).
    expect(
      r.propensity(task(), candidates, new Date(`${MONDAY}06:00:00Z`)),
    ).toBe(0);
  });
});

describe("identityReRanker — uniform propensity", () => {
  it("is 1/n over the candidates", () => {
    expect(
      identityReRanker.propensity(task(), candidates, candidates[0]),
    ).toBeCloseTo(1 / candidates.length, 10);
  });
});
