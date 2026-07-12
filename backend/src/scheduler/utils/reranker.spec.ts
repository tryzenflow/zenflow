import { PREFERENCE_MATRIX_LENGTH } from "@zenflow/shared";
import { pickBest, rankCandidates, topN } from "./reranker";
import type { Interval } from "./slot";

/**
 * Phase-2 softmax/Gumbel-top re-ranker coverage (docs/heuristic.md). Candidate
 * starts are plain epoch ms so tests don't need real calendar math — only
 * `preferenceIndex` (exercised in slot.spec.ts) cares about the actual date.
 */

const TZ = "UTC";
// 2026-06-08 is a Monday; 09:00 UTC → preferenceIndex 9, 10:00 → 10, etc.
function candidateAt(hh: number): Interval {
  const start = new Date(
    `2026-06-08T${String(hh).padStart(2, "0")}:00:00.000Z`,
  ).getTime();
  return { start, end: start + 60 * 60_000 };
}

function zeroMatrix(): number[] {
  return new Array<number>(PREFERENCE_MATRIX_LENGTH).fill(0);
}

describe("rankCandidates — cold start", () => {
  it("returns identity order with uniform propensity for an all-zero matrix", () => {
    const candidates = [candidateAt(9), candidateAt(10), candidateAt(11)];
    const ranked = rankCandidates(candidates, zeroMatrix(), TZ, "task-1");
    expect(ranked.map((r) => r.start.getTime())).toEqual(
      candidates.map((c) => c.start),
    );
    expect(ranked.every((r) => r.propensity === 1 / 3)).toBe(true);
  });

  it("treats a wrong-length matrix as cold start too", () => {
    const candidates = [candidateAt(9), candidateAt(10)];
    const ranked = rankCandidates(candidates, [1, 2, 3], TZ, "task-1");
    expect(ranked.map((r) => r.start.getTime())).toEqual(
      candidates.map((c) => c.start),
    );
    expect(ranked.every((r) => r.propensity === 0.5)).toBe(true);
  });

  it("returns [] for an empty candidate list regardless of matrix", () => {
    expect(rankCandidates([], zeroMatrix(), TZ, "task-1")).toEqual([]);
  });

  it("handles a single candidate: propensity 1, identity order", () => {
    const candidates = [candidateAt(9)];
    const ranked = rankCandidates(candidates, zeroMatrix(), TZ, "task-1");
    expect(ranked).toHaveLength(1);
    expect(ranked[0].propensity).toBe(1);
  });
});

describe("rankCandidates — warm matrix", () => {
  function warmMatrix(liked: number, score: number): number[] {
    const m = zeroMatrix();
    m[liked] = score;
    return m;
  }

  it("is deterministic per task id: same id + same candidates → same order", () => {
    const candidates = [
      candidateAt(9),
      candidateAt(10),
      candidateAt(11),
      candidateAt(12),
    ];
    const matrix = warmMatrix(11, 3); // Monday 11:00 is strongly liked
    const a = rankCandidates(candidates, matrix, TZ, "task-42");
    const b = rankCandidates(candidates, matrix, TZ, "task-42");
    expect(a.map((r) => r.start.getTime())).toEqual(
      b.map((r) => r.start.getTime()),
    );
  });

  it("different task ids can draw different orders (seeded per task id)", () => {
    const candidates = [
      candidateAt(9),
      candidateAt(10),
      candidateAt(11),
      candidateAt(12),
    ];
    const matrix = warmMatrix(11, 1); // mild preference — leaves room for noise to matter
    const orders = new Set(
      ["task-a", "task-b", "task-c", "task-d", "task-e"].map((id) =>
        rankCandidates(candidates, matrix, TZ, id)
          .map((r) => r.start.getTime())
          .join(","),
      ),
    );
    // Not a strict guarantee, but with 4! possible permutations and 5 seeds,
    // seeing more than one distinct order confirms the seed actually varies.
    expect(orders.size).toBeGreaterThan(1);
  });

  it("propensities sum to 1 across the feasible set", () => {
    const candidates = [candidateAt(9), candidateAt(10), candidateAt(11)];
    const matrix = warmMatrix(10, 2);
    const ranked = rankCandidates(candidates, matrix, TZ, "task-1");
    const sum = ranked.reduce((s, r) => s + r.propensity, 0);
    expect(sum).toBeCloseTo(1);
  });

  it("assigns the highest propensity to the highest-scoring cell", () => {
    const candidates = [candidateAt(9), candidateAt(10), candidateAt(11)];
    const matrix = warmMatrix(10, 5);
    const ranked = rankCandidates(candidates, matrix, TZ, "task-1");
    const best = ranked.find(
      (r) => r.start.getTime() === candidateAt(10).start,
    )!;
    expect(ranked.every((r) => r.propensity <= best.propensity)).toBe(true);
  });

  it("never drops or invents a candidate — pure permutation of the input", () => {
    const candidates = [
      candidateAt(9),
      candidateAt(10),
      candidateAt(11),
      candidateAt(12),
    ];
    const matrix = warmMatrix(9, -3); // a disliked cell
    const ranked = rankCandidates(candidates, matrix, TZ, "task-7");
    expect(ranked.map((r) => r.start.getTime()).sort()).toEqual(
      candidates.map((c) => c.start).sort(),
    );
  });
});

describe("pickBest / topN", () => {
  it("pickBest returns the top-ranked candidate, or null when empty", () => {
    const candidates = [candidateAt(9), candidateAt(10)];
    expect(pickBest([], zeroMatrix(), TZ, "task-1")).toBeNull();
    const best = pickBest(candidates, zeroMatrix(), TZ, "task-1");
    expect(best).not.toBeNull();
  });

  it("topN returns at most n candidates, fewer when the set is smaller", () => {
    const candidates = [candidateAt(9), candidateAt(10)];
    expect(topN(candidates, zeroMatrix(), TZ, "task-1", 5)).toHaveLength(2);
    expect(topN(candidates, zeroMatrix(), TZ, "task-1", 1)).toHaveLength(1);
  });
});
