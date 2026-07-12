import { gumbelNoise, mulberry32, seedFromString } from "./rng";

describe("mulberry32 — deterministic seeded PRNG", () => {
  it("produces the same sequence for the same seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = Array.from({ length: 5 }, () => a());
    const seqB = Array.from({ length: 5 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it("produces different sequences for different seeds", () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    expect(a()).not.toBe(b());
  });

  it("always returns floats in [0, 1)", () => {
    const rand = mulberry32(12345);
    for (let i = 0; i < 100; i++) {
      const v = rand();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("seedFromString — deterministic id → uint32 seed", () => {
  it("is deterministic for the same id", () => {
    expect(seedFromString("task-123")).toBe(seedFromString("task-123"));
  });

  it("differs for different ids (no trivial collision)", () => {
    expect(seedFromString("task-a")).not.toBe(seedFromString("task-b"));
  });

  it("always returns a non-negative uint32", () => {
    expect(seedFromString("")).toBeGreaterThanOrEqual(0);
    expect(seedFromString("x".repeat(100))).toBeGreaterThanOrEqual(0);
  });
});

describe("gumbelNoise — inverse-transform Gumbel(0,1) sample", () => {
  it("is deterministic given a deterministic generator", () => {
    const randA = mulberry32(7);
    const randB = mulberry32(7);
    expect(gumbelNoise(randA)).toBe(gumbelNoise(randB));
  });

  it("returns a finite number for any uniform in (0,1)", () => {
    const rand = mulberry32(99);
    for (let i = 0; i < 50; i++) {
      expect(Number.isFinite(gumbelNoise(rand))).toBe(true);
    }
  });

  it("never produces NaN/Infinity even at the boundary U→0 or U→1", () => {
    expect(Number.isFinite(gumbelNoise(() => 0))).toBe(true);
    expect(Number.isFinite(gumbelNoise(() => 1))).toBe(true);
  });
});
