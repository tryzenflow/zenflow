import { makeRng, round15, seedFor } from "./rng";

/**
 * Determinism is the contract: the same seed must yield the same stream, and the
 * derived child seeds must be stable. The sampling helpers must also respect
 * their bounds (grid invariant #3 for `round15`).
 */
describe("rng", () => {
  it("produces an identical sequence for the same seed", () => {
    const a = makeRng(42);
    const b = makeRng(42);
    const seqA = Array.from({ length: 100 }, () => a.next());
    const seqB = Array.from({ length: 100 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it("produces a different sequence for a different seed", () => {
    const a = makeRng(1);
    const b = makeRng(2);
    const seqA = Array.from({ length: 50 }, () => a.next());
    const seqB = Array.from({ length: 50 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
  });

  it("uses no Math.random (output is pure function of the seed)", () => {
    const spy = jest.spyOn(Math, "random");
    const r = makeRng(7);
    for (let i = 0; i < 100; i++) {
      r.next();
      r.normal();
      r.lognormal(0, 1);
      r.int(10);
      r.poisson(2);
      r.weighted([1, 2, 3], [1, 1, 1]);
      r.pick([1, 2, 3]);
    }
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("next() stays in [0, 1)", () => {
    const r = makeRng(99);
    for (let i = 0; i < 1000; i++) {
      const x = r.next();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it("int(n) stays in [0, n)", () => {
    const r = makeRng(3);
    for (let i = 0; i < 1000; i++) {
      const x = r.int(5);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(5);
    }
  });

  it("weighted respects the weights distribution roughly", () => {
    const r = makeRng(5);
    const counts = { a: 0, b: 0, c: 0 };
    for (let i = 0; i < 10000; i++) {
      counts[r.weighted(["a", "b", "c"], [8, 1, 1])]++;
    }
    // 'a' has 80% of the mass; it should dominate.
    expect(counts.a).toBeGreaterThan(counts.b + counts.c);
  });

  it("normal is centered near its mean", () => {
    const r = makeRng(11);
    let sum = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) sum += r.normal(10, 2);
    const m = sum / n;
    expect(Math.abs(m - 10)).toBeLessThan(0.1);
  });

  describe("round15", () => {
    it("rounds to the nearest positive multiple of 15", () => {
      expect(round15(0)).toBe(15);
      expect(round15(7)).toBe(15);
      expect(round15(22)).toBe(15);
      expect(round15(23)).toBe(30);
      expect(round15(60)).toBe(60);
      expect(round15(67)).toBe(60);
      expect(round15(68)).toBe(75);
    });

    it("never returns less than 15", () => {
      expect(round15(-100)).toBe(15);
      expect(round15(1)).toBe(15);
    });
  });

  describe("seedFor", () => {
    it("is deterministic", () => {
      expect(seedFor(1, 2, 3)).toBe(seedFor(1, 2, 3));
    });

    it("differs across keys", () => {
      expect(seedFor(1, 2)).not.toBe(seedFor(1, 3));
      expect(seedFor(1, 0)).not.toBe(seedFor(2, 0));
    });
  });
});
