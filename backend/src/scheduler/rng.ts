/**
 * Minimal PURE seeded PRNG for the scheduler core.
 *
 * Invariant #2 (refined): the scheduler core may use randomness ONLY via an
 * injected seed, so it stays a pure, reproducible function of `(inputs + seed)`.
 * The Phase-2 softmax/Boltzmann re-ranker ({@link preferenceMatrixReRanker})
 * needs Gumbel noise to sample a slot stochastically; it draws that noise from
 * here, seeded per-task, never from `Math.random()`.
 *
 * The simulator has its own richer `mulberry32` (`simulation/rng.ts`) with all
 * the sampling helpers it needs, but the scheduler core must NOT import from
 * `simulation/` (that would couple the pure core to the sim harness). So this is
 * a tiny, self-contained, byte-identical `mulberry32` kept local to the core —
 * same canonical arithmetic, only the uniform `next()` the re-ranker uses.
 */

/** A pure seeded uniform source: `next()` yields a value in [0, 1). */
export interface ScheduleRng {
  next: () => number;
}

/**
 * mulberry32 — a 32-bit seeded PRNG. The same seed always yields the same
 * stream, so a re-ranker built on it is deterministic given its seed (fully
 * unit-testable). Canonical reference arithmetic, identical to the simulator's.
 */
export function makeRng(seed: number): ScheduleRng {
  let s = seed >>> 0;
  return {
    next(): number {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

/**
 * A 32-bit FNV-1a-style hash of a string → an unsigned seed. Used to derive a
 * STABLE per-task seed from the task id alone (NOT from `now`): re-packing the
 * same task on an unrelated cascade then yields the SAME Gumbel draw, so the
 * sampled slot doesn't churn (protects the Time-to-stable metric — see
 * {@link preferenceMatrixReRanker}). Pure; no I/O, no clock.
 */
export function hashSeed(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * A standard Gumbel(0,1) sample from a uniform draw: `g = -log(-log(u))`. Used
 * for the Gumbel-top-k trick — adding independent Gumbel noise to each logit and
 * taking the argmax samples exactly from the softmax over those logits, while
 * the result is still a permutation of the inputs. `u` is guarded away from 0
 * (and 1) so both logs stay finite.
 */
export function gumbel(rng: ScheduleRng): number {
  // Clamp u into (0, 1) so neither log() blows up.
  const u = Math.min(1 - 1e-12, Math.max(1e-12, rng.next()));
  return -Math.log(-Math.log(u));
}
