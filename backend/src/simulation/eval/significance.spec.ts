import {
  bootstrapMeanCI,
  cliffsDelta,
  normalCdf,
  pairByUser,
  pairedMarAnalysis,
  perPersonaMar,
  summarizeSweep,
  wilcoxonSignedRank,
  type MetricsDump,
  type SeedResult,
} from "./significance";

/**
 * Pure significance stats (ADR-0001 §5, phase-2-eval §Step 6). These back the
 * runnable `sim:significance` analysis; they are unit-tested because they are
 * deterministic math (the analysis OVER a fresh population is the script's job).
 */

describe("normalCdf", () => {
  it("is 0.5 at the mean and symmetric", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 3);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 2);
    expect(normalCdf(-1.96)).toBeCloseTo(0.025, 2);
  });
});

describe("wilcoxonSignedRank", () => {
  it("drops zero deltas and reports n=0 for an all-zero vector", () => {
    const r = wilcoxonSignedRank([0, 0, 0]);
    expect(r.n).toBe(0);
    expect(r.p).toBe(1);
  });

  it("yields a small p when every delta favours one direction", () => {
    // All-positive deltas (B always lower MAR) → strong signal.
    const r = wilcoxonSignedRank([0.1, 0.2, 0.15, 0.3, 0.25, 0.05, 0.4, 0.18]);
    expect(r.n).toBe(8);
    expect(r.p).toBeLessThan(0.05);
  });

  it("yields a large p for symmetric noise around zero", () => {
    const r = wilcoxonSignedRank([0.1, -0.1, 0.12, -0.11, 0.09, -0.1]);
    expect(r.p).toBeGreaterThan(0.2);
  });
});

describe("cliffsDelta", () => {
  it("is +1 when every a exceeds every b", () => {
    expect(cliffsDelta([3, 4, 5], [0, 1, 2])).toBeCloseTo(1);
  });
  it("is -1 when every a is below every b", () => {
    expect(cliffsDelta([0, 1], [2, 3])).toBeCloseTo(-1);
  });
  it("is ~0 for interleaved equal distributions", () => {
    expect(cliffsDelta([1, 2, 3, 4], [1, 2, 3, 4])).toBeCloseTo(0);
  });
});

describe("bootstrapMeanCI", () => {
  it("brackets the sample mean and is deterministic", () => {
    const xs = [0.1, 0.12, 0.08, 0.15, 0.11, 0.09, 0.13];
    const ci = bootstrapMeanCI(xs);
    expect(ci.mean).toBeCloseTo(0.1114, 3);
    expect(ci.lo).toBeLessThanOrEqual(ci.mean);
    expect(ci.hi).toBeGreaterThanOrEqual(ci.mean);
    // Same seed → identical CI.
    expect(bootstrapMeanCI(xs)).toEqual(ci);
  });
});

describe("pairedMarAnalysis", () => {
  it("computes a positive delta when Phase-2 lowers MAR", () => {
    const marA = [0.82, 0.8, 0.85, 0.79, 0.81]; // identity
    const marB = [0.6, 0.62, 0.7, 0.55, 0.63]; // phase2 (lower)
    const an = pairedMarAnalysis(marA, marB);
    expect(an.personas).toBe(5);
    expect(an.deltaMean).toBeGreaterThan(0);
    expect(an.cliffsDelta).toBeGreaterThan(0);
    expect(an.ci95.lo).toBeGreaterThan(0); // whole CI above zero
  });
});

describe("perPersonaMar + pairByUser (stable per-persona key)", () => {
  it("keys by the deterministic personaKey, not the random userId", () => {
    const m = perPersonaMar({
      metrics: {
        perPersona: [
          { userId: "uuid-1", personaKey: "sim-dev-0-1@zenflow.sim", mar: 0.3 },
        ],
      },
    });
    expect(m.get("sim-dev-0-1@zenflow.sim")).toBe(0.3);
    expect(m.get("uuid-1")).toBeUndefined();
  });

  it("pairs the two arms by personaKey even when userIds differ across arms", () => {
    // Same persona (same email) gets a DIFFERENT random userId in each arm —
    // the whole point of the stable key. Pairing must still align them.
    const armA: MetricsDump = {
      metrics: {
        perPersona: [
          {
            userId: "a-uuid-1",
            personaKey: "sim-dev-0-1@zenflow.sim",
            mar: 0.8,
          },
          {
            userId: "a-uuid-2",
            personaKey: "sim-crammer-1-1@zenflow.sim",
            mar: 0.85,
          },
        ],
      },
    };
    const armB: MetricsDump = {
      metrics: {
        perPersona: [
          // Note: userIds are different from arm A, ordering shuffled.
          {
            userId: "b-uuid-9",
            personaKey: "sim-crammer-1-1@zenflow.sim",
            mar: 0.6,
          },
          {
            userId: "b-uuid-8",
            personaKey: "sim-dev-0-1@zenflow.sim",
            mar: 0.5,
          },
        ],
      },
    };
    const { marA, marB } = pairByUser(perPersonaMar(armA), perPersonaMar(armB));
    // dev paired: 0.8↔0.5 ; crammer paired: 0.85↔0.6 (order follows arm A's map).
    expect(marA).toEqual([0.8, 0.85]);
    expect(marB).toEqual([0.5, 0.6]);
  });

  it("falls back to userId for legacy dumps without a personaKey", () => {
    const m = perPersonaMar({
      perPersona: [{ userId: "legacy-1", mar: 0.42 }],
    });
    expect(m.get("legacy-1")).toBe(0.42);
  });

  it("drops personas present in only one arm", () => {
    const a = perPersonaMar({
      perPersona: [
        { userId: "x", personaKey: "k1", mar: 0.7 },
        { userId: "y", personaKey: "k2", mar: 0.6 },
      ],
    });
    const b = perPersonaMar({
      perPersona: [{ userId: "z", personaKey: "k1", mar: 0.5 }],
    });
    const { marA, marB } = pairByUser(a, b);
    expect(marA).toEqual([0.7]);
    expect(marB).toEqual([0.5]);
  });
});

describe("summarizeSweep", () => {
  it("aggregates the multi-seed robustness loop and counts significant wins", () => {
    const mk = (seed: number, deltaMean: number, p: number): SeedResult => ({
      seed,
      analysis: {
        personas: 10,
        marAMean: 0.8,
        marBMean: 0.8 - deltaMean,
        deltaMean,
        wilcoxon: { w: 0, n: 10, z: 0, p },
        cliffsDelta: deltaMean > 0 ? 0.5 : 0,
        ci95: { lo: 0, hi: deltaMean * 2, mean: deltaMean },
      },
    });
    const sweep = summarizeSweep([
      mk(1, 0.2, 0.01),
      mk(2, 0.15, 0.04),
      mk(3, 0.05, 0.2), // not significant
    ]);
    expect(sweep.seeds).toEqual([1, 2, 3]);
    expect(sweep.deltaMeanAcrossSeeds).toBeCloseTo(0.4 / 3);
    expect(sweep.deltaMinAcrossSeeds).toBeCloseTo(0.05);
    expect(sweep.deltaMaxAcrossSeeds).toBeCloseTo(0.2);
    expect(sweep.fractionSignificantWins).toBeCloseTo(2 / 3);
  });
});
