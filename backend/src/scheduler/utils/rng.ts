/**
 * Pure seeded PRNG + Gumbel-noise helper for the softmax re-ranker
 * (docs/heuristic.md §Phase 2, CLAUDE.md invariant #2). No I/O, no clock, no
 * `Math.random()` — the ONLY randomness the scheduler core is allowed is via
 * an explicitly injected seed, so the re-ranker stays a pure, reproducible
 * function of `(inputs + seed)`.
 */

/**
 * mulberry32 — a small, fast, deterministic 32-bit PRNG. Given the same seed,
 * the returned generator always produces the same sequence of floats in
 * `[0, 1)`. Not cryptographically secure; that's not the goal here.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function random(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Hash a task id (string) to a uint32 seed for {@link mulberry32}. Deterministic
 * per id — the same task id always yields the same seed, and therefore the
 * same Gumbel draws, so re-packing a task on an unrelated cascade never
 * churns its chosen slot (docs/heuristic.md's "no slot churn" guarantee).
 * A simple FNV-1a style hash — collision-tolerant is fine here since a
 * collision only means two tasks share a draw sequence, not a correctness bug.
 */
export function seedFromString(id: string): number {
  let hash = 2166136261; // FNV offset basis
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Draw one Gumbel(0,1) sample from a uniform `[0,1)` generator via inverse
 * transform sampling: `-ln(-ln(U))`. Used by the Gumbel-top trick to turn a
 * deterministic softmax score into a single stochastic draw while keeping the
 * whole operation reproducible given the same `rand` sequence.
 */
export function gumbelNoise(rand: () => number): number {
  // Guard against U=0 (ln(0) = -Infinity) — vanishingly unlikely from
  // mulberry32's range but keep the function total or 1 (ln(1)=0, then
  // -ln(0) = Infinity) — clamp into the open interval.
  const u = Math.min(Math.max(rand(), Number.EPSILON), 1 - Number.EPSILON);
  return -Math.log(-Math.log(u));
}
