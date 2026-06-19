/**
 * Deterministic pseudo-random number generation for the persona simulator.
 *
 * Pure: every source of randomness in the simulator flows through a single
 * seeded `mulberry32` PRNG so a run is byte-reproducible — no `Math.random()`
 * anywhere. The generator is a tiny, fast, well-distributed 32-bit PRNG; we wrap
 * it with the sampling helpers the persona/behaviour layers need (Box–Muller
 * normals, lognormals, uniform picks, weighted picks). Nothing here touches I/O
 * or the clock.
 */

export interface Rng {
  /** Uniform sample in [0, 1). */
  next: () => number;
  /** Uniform integer in [0, n). */
  int: (n: number) => number;
  /** Gaussian sample via Box–Muller. */
  normal: (mean?: number, sd?: number) => number;
  /** Lognormal sample: `exp(normal(mu, sigma))`. */
  lognormal: (mu: number, sigma: number) => number;
  /** Uniform pick from a non-empty array. */
  pick: <T>(xs: readonly T[]) => T;
  /** Weighted pick: `weights[i]` is the relative mass of `xs[i]`. */
  weighted: <T>(xs: readonly T[], weights: readonly number[]) => T;
  /** True with probability `p`. */
  bool: (p: number) => boolean;
  /** Uniform sample in [min, max). */
  range: (min: number, max: number) => number;
  /**
   * A Poisson sample (Knuth's algorithm) — used for over-dispersed-ish arrival
   * counts when combined with a gamma-mixed rate. Small lambdas only.
   */
  poisson: (lambda: number) => number;
}

/**
 * mulberry32 — a 32-bit seeded PRNG. Same seed always yields the same stream.
 * The arithmetic is the canonical reference implementation.
 */
export function makeRng(seed: number): Rng {
  let s = seed >>> 0;
  const next = (): number => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const normal = (mean = 0, sd = 1): number => {
    // Box–Muller; guard u away from 0 so log() is finite.
    const u = 1 - next();
    const v = next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };

  const pick = <T>(xs: readonly T[]): T => {
    if (xs.length === 0) throw new Error("rng.pick: empty array");
    return xs[Math.floor(next() * xs.length)];
  };

  const weighted = <T>(xs: readonly T[], weights: readonly number[]): T => {
    if (xs.length === 0) throw new Error("rng.weighted: empty array");
    if (xs.length !== weights.length)
      throw new Error("rng.weighted: length mismatch");
    const total = weights.reduce((a, b) => a + b, 0);
    if (total <= 0) return xs[0];
    let r = next() * total;
    for (let i = 0; i < xs.length; i++) {
      r -= weights[i];
      if (r < 0) return xs[i];
    }
    return xs[xs.length - 1];
  };

  const poisson = (lambda: number): number => {
    if (lambda <= 0) return 0;
    const L = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= next();
    } while (p > L);
    return k - 1;
  };

  return {
    next,
    int: (n: number) => Math.floor(next() * n),
    normal,
    lognormal: (mu: number, sigma: number) => Math.exp(normal(mu, sigma)),
    pick,
    weighted,
    bool: (p: number) => next() < p,
    range: (min: number, max: number) => min + next() * (max - min),
    poisson,
  };
}

/** Round minutes to the nearest positive multiple of 15 (grid invariant #3). */
export const round15 = (m: number): number =>
  Math.max(15, Math.round(m / 15) * 15);

/**
 * Derive a child seed from a base seed and one or more integer keys. Lets the
 * runner give each persona (and each step) its own independent, reproducible
 * stream keyed by index — `makeRng(seedFor(base, personaIdx))`.
 */
export function seedFor(base: number, ...keys: number[]): number {
  let h = base >>> 0;
  for (const k of keys) {
    h = (Math.imul(h ^ (k >>> 0), 0x9e3779b1) + 0x85ebca6b) | 0;
  }
  return h >>> 0;
}
