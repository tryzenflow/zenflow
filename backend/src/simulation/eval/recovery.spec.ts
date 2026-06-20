import {
  cosineSimilarity,
  durationRecovery,
  l2Normalize,
  placementRecovery,
} from "./recovery-metrics";

/**
 * Pure recovery scoring (ADR-0001 §5, phase-2-eval §Step 6). The I/O `main()` and
 * `scoreRecovery` (which read the sidecar + DB) are exercised by the runnable
 * `sim:recovery` script; these cover the math.
 */

describe("l2Normalize", () => {
  it("scales a vector to unit length", () => {
    const u = l2Normalize([3, 4]);
    expect(Math.hypot(u[0], u[1])).toBeCloseTo(1);
    expect(u).toEqual([0.6, 0.8]);
  });
  it("leaves an all-zero vector unchanged (no divide-by-zero)", () => {
    expect(l2Normalize([0, 0, 0])).toEqual([0, 0, 0]);
  });
});

describe("cosineSimilarity", () => {
  it("is 1 for parallel vectors regardless of scale", () => {
    expect(cosineSimilarity([1, 2, 3], [2, 4, 6])).toBeCloseTo(1);
  });
  it("is 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });
  it("is -1 for opposed vectors", () => {
    expect(cosineSimilarity([1, 1], [-1, -1])).toBeCloseTo(-1);
  });
});

describe("placementRecovery", () => {
  it("scores a perfectly-aligned matrix as distance 0 / cosine 1", () => {
    // Same shape, different magnitude (the matrix is an unbounded accumulator).
    const pGlobal = [0, 1, 2, 3];
    const learned = [0, 5, 10, 15];
    const r = placementRecovery(learned, pGlobal);
    expect(r.distance).toBeCloseTo(0);
    expect(r.cosine).toBeCloseTo(1);
  });

  it("scores a cold-start (all-zero) matrix as no recovery (cosine 0)", () => {
    const r = placementRecovery([0, 0, 0, 0], [0, 1, 2, 3]);
    expect(r.cosine).toBeCloseTo(0);
  });

  it("a better-aligned matrix has a smaller distance than a worse one", () => {
    const pGlobal = [0, 0, 5, 0];
    const good = placementRecovery([0, 0, 3, 0], pGlobal); // right cell
    const bad = placementRecovery([3, 0, 0, 0], pGlobal); // wrong cell
    expect(good.distance).toBeLessThan(bad.distance);
  });
});

describe("durationRecovery", () => {
  it("computes the mean absolute error over shared tags", () => {
    const est = new Map([
      ["a", { n: 5, b: 1.4 }],
      ["b", { n: 3, b: 0.9 }],
    ]);
    const truth = {
      a: { mu: 0, sigma: 0.2, bias: 1.5 }, // |1.4-1.5| = 0.1
      b: { mu: 0, sigma: 0.2, bias: 1.0 }, // |0.9-1.0| = 0.1
    };
    const r = durationRecovery(est, truth);
    expect(r.tags).toBe(2);
    expect(r.mae).toBeCloseTo(0.1);
  });

  it("only scores tags present in BOTH the estimate and the truth", () => {
    const est = new Map([["a", { n: 1, b: 2.0 }]]);
    const truth = {
      a: { mu: 0, sigma: 0.1, bias: 1.0 }, // |2-1| = 1
      missing: { mu: 0, sigma: 0.1, bias: 9 }, // not estimated → skipped
    };
    const r = durationRecovery(est, truth);
    expect(r.tags).toBe(1);
    expect(r.mae).toBeCloseTo(1);
  });
});
