import type { PersonaGroundTruth } from "./ground-truth";

/**
 * PURE recovery-scoring math (phase-2-evaluation-steps §Step 6, ADR-0001 §5).
 * Split out of `recovery.ts` (the Nest entry point) so these functions are
 * unit-testable without loading the whole module graph — `recovery.ts` imports
 * them and wraps them with the DB/sidecar I/O.
 *
 *  - Placement: `‖matrix_normalized − pGlobal_normalized‖`. Both are L2-normalized
 *    first (the learned matrix is an unbounded signed accumulator; `pGlobal` is a
 *    continuous field — only their SHAPE is comparable), so the distance lives in
 *    [0, 2] (0 = same direction, √2 = orthogonal, 2 = opposed). Cosine similarity
 *    is reported alongside.
 *  - Duration: `|b̂_tag − b_tag|` MAE of the estimated per-tag bias vs the true
 *    `bias = exp(mu)` the sidecar stores.
 */

/** L2 norm of a vector. */
function l2(v: number[]): number {
  let s = 0;
  for (const x of v) s += x * x;
  return Math.sqrt(s);
}

/** Return a unit-L2-normalized copy; an all-zero vector stays all-zero. */
export function l2Normalize(v: number[]): number[] {
  const n = l2(v);
  return n > 0 ? v.map((x) => x / n) : v.slice();
}

/** Euclidean distance between two equal-length vectors (0 if mismatched length). */
function euclidean(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s);
}

/** Cosine similarity in [-1, 1]; 0 if either vector is all-zero. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  const denom = l2(a) * l2(b);
  return denom > 0 ? dot / denom : 0;
}

/**
 * Placement recovery for one persona: the unit-vector distance + cosine
 * similarity between the learned matrix and the true `pGlobal` (both
 * L2-normalized). A cold-start (all-zero) learned matrix yields the worst-case
 * cosine 0 — it recovered nothing.
 */
export function placementRecovery(
  learnedMatrix: number[],
  pGlobal: number[],
): { distance: number; cosine: number } {
  const a = l2Normalize(learnedMatrix);
  const b = l2Normalize(pGlobal);
  return { distance: euclidean(a, b), cosine: cosineSimilarity(a, b) };
}

/**
 * Duration recovery for one persona: mean |b̂_tag − b_tag| over the tags BOTH the
 * true sidecar and the estimate cover. Returns the MAE and the tag count scored.
 */
export function durationRecovery(
  estimated: Map<string, { n: number; b: number }>,
  trueBias: PersonaGroundTruth["tagBias"],
): { mae: number; tags: number } {
  let sum = 0;
  let n = 0;
  for (const [tag, truth] of Object.entries(trueBias)) {
    const est = estimated.get(tag);
    if (!est) continue;
    sum += Math.abs(est.b - truth.bias);
    n++;
  }
  return { mae: n > 0 ? sum / n : 0, tags: n };
}
