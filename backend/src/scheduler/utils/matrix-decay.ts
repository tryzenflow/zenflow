/**
 * Pure exponential time-decay for the signed preference matrix.
 * A daily NestJS `@Cron` job fades stale placement
 * preferences without hard cutoffs, so a habit a user has abandoned decays toward
 * neutral instead of lingering forever.
 *
 * Pure: this file only does the decay math. The cron WRAPPER (the
 * only I/O layer) loads each user's matrix + `lastDecayedAt`, calls
 * {@link decayMatrix}, and writes the result back.
 */

/**
 * Matrix decay half-life in DAYS — after this many days, an untouched cell's
 * magnitude halves. A configurable constant: 21 days ≈ a three-week half-life, slow enough that a
 * genuine weekly habit survives but stale one-offs fade.
 */
export const MATRIX_HALF_LIFE_DAYS = 21;

/**
 * Apply `deltaDays` worth of exponential decay to every cell of a flat signed
 * matrix, returning a NEW array (the input is not mutated):
 *
 *   cell *= 2^(−Δdays / halfLifeDays)
 *
 * `deltaDays <= 0` is a no-op (returns a copy unchanged) — running the cron twice
 * in a day, or with a clock skew, never amplifies a cell. `halfLifeDays <= 0` is
 * treated as no decay (guards against a misconfigured constant zeroing the
 * matrix). The sign of each cell is preserved; only the magnitude shrinks toward
 * neutral 0.
 */
export function decayMatrix(
  matrix: number[],
  deltaDays: number,
  halfLifeDays: number = MATRIX_HALF_LIFE_DAYS,
): number[] {
  if (!(deltaDays > 0) || !(halfLifeDays > 0)) return [...matrix];
  const factor = Math.pow(2, -deltaDays / halfLifeDays);
  return matrix.map((cell) => cell * factor);
}
