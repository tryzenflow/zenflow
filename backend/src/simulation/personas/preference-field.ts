import {
  PREFERENCE_MATRIX_LENGTH,
  PREFERENCE_SLOTS_PER_DAY,
} from "@zenflow/shared";
import { preferenceIndex } from "../../scheduler/slot";
import type { Archetype, PeakSpec, TagTimeInteraction } from "./archetypes";
import type { Rng } from "../rng";

/**
 * The hidden preference field a persona reacts against (strategy §4.3, §5).
 *
 * Pure: builds the latent ground-truth fields from an archetype's distributions
 * (the only randomness is the seeded `rng` passed in by the factory), and scores
 * candidate slots. NO I/O — `scoreSlot` reuses the production `preferenceIndex`
 * (`scheduler/slot.ts`) so the 7×8 grid the persona reasons over is byte-for-
 * byte the same grid Phase 2's `preferenceMatrix` accumulates into.
 *
 * Two strictly separate layers (the cardinal anti-circularity rule, strategy
 * §1.1, §4.2):
 *  - `pGlobal` (56 cells): the global temporal field — what a Phase-2 matrix can
 *    approximate.
 *  - `pTag` (per-tag 56-cell deviations): the tag×time interactions only a
 *    Phase-3 context bandit can exploit. A persona that has none cannot let
 *    Phase 3 beat Phase 2 — so it must be present and distinct.
 */

const SLOTS = PREFERENCE_SLOTS_PER_DAY; // 8
const DAYS = 7;

/** Add a Gaussian bump to a 56-cell grid, wrapping the bucket-of-day axis. */
function addBump(
  grid: Float64Array,
  day: number, // ISO weekday 1…7, or -1 = all days
  block: number, // 0…7 center
  height: number,
  spread: number, // buckets
): void {
  const days = day === -1 ? [1, 2, 3, 4, 5, 6, 7] : [day];
  const twoSigmaSq = 2 * spread * spread;
  for (const d of days) {
    const dayBase = (d - 1) * SLOTS;
    for (let s = 0; s < SLOTS; s++) {
      // Circular distance on the 96-slot day axis.
      let dist = Math.abs(s - block);
      dist = Math.min(dist, SLOTS - dist);
      grid[dayBase + s] += height * Math.exp(-(dist * dist) / twoSigmaSq);
    }
  }
}

/** Build the global temporal field `P_global` from an archetype's peaks. */
export function buildPGlobal(
  peaks: PeakSpec[],
  rng: Rng,
  jitter = 0.15,
): Float64Array {
  const grid = new Float64Array(PREFERENCE_MATRIX_LENGTH);
  for (const p of peaks) {
    // Per-persona jitter on height + a small block shift so members differ.
    const height = p.height * (1 + rng.normal(0, jitter));
    const block = p.block + Math.round(rng.normal(0, 0.1));
    addBump(grid, p.day, ((block % SLOTS) + SLOTS) % SLOTS, height, p.spread);
  }
  return grid;
}

/** Build the per-tag deviation fields `P_tag` from the tag×time interactions. */
export function buildPTag(
  interactions: TagTimeInteraction[],
  rng: Rng,
  jitter = 0.15,
): Map<string, Float64Array> {
  const out = new Map<string, Float64Array>();
  for (const it of interactions) {
    let grid = out.get(it.tag);
    if (!grid) {
      grid = new Float64Array(PREFERENCE_MATRIX_LENGTH);
      out.set(it.tag, grid);
    }
    const delta = it.delta * (1 + rng.normal(0, jitter));
    const block = it.block + Math.round(rng.normal(0, 0.1));
    addBump(grid, -1, ((block % SLOTS) + SLOTS) % SLOTS, delta, it.spread);
  }
  return out;
}

/**
 * Apply a month's worth of slow drift to the latent fields in place: shift every
 * peak along the slot axis by `peakShiftBlocks` and decay tag biases. Returns a
 * fresh drifted copy so the original archetype ground truth is preserved per
 * snapshot (the runner can log drift if needed).
 */
export function driftPGlobal(
  pGlobal: Float64Array,
  shiftBlocks: number,
): Float64Array {
  if (shiftBlocks === 0) return pGlobal;
  const out = new Float64Array(PREFERENCE_MATRIX_LENGTH);
  const shift = Math.round(shiftBlocks);
  for (let d = 0; d < DAYS; d++) {
    const base = d * SLOTS;
    for (let s = 0; s < SLOTS; s++) {
      const src = (((s - shift) % SLOTS) + SLOTS) % SLOTS;
      out[base + s] = pGlobal[base + src];
    }
  }
  return out;
}

/**
 * The drifted preference field a persona reacts against after `monthsElapsed` of
 * slow non-stationary drift (strategy §4.3). `shiftBlocks = peakShiftBlocks ×
 * monthsElapsed` slides the global temporal peaks along the slot-of-day axis;
 * `pTag` is left as-is (per-tag tag×time interactions are a Phase-3 concern and
 * carry their own `biasDecay` accounting elsewhere). Returns the SAME field
 * object when there is no net shift, so a persona with zero drift (or `--drift-
 * mult=0`) reproduces the un-drifted behaviour byte-for-byte. PURE: no RNG, no
 * clock — the only input is the elapsed months the runner threads in.
 */
export function driftedFieldFor(
  field: PreferenceField,
  peakShiftBlocks: number,
  monthsElapsed: number,
): PreferenceField {
  const shift = peakShiftBlocks * monthsElapsed;
  if (Math.round(shift) === 0) return field;
  return { ...field, pGlobal: driftPGlobal(field.pGlobal, shift) };
}

/** The persona's latent fields + the scalar reaction parameters. */
export interface PreferenceField {
  pGlobal: Float64Array;
  pTag: Map<string, Float64Array>;
  procrastination: number;
}

export function buildPreferenceField(
  a: Archetype,
  rng: Rng,
  procrastination: number,
): PreferenceField {
  return {
    pGlobal: buildPGlobal(a.peaks, rng),
    pTag: buildPTag(a.tagTimeInteractions, rng),
    procrastination,
  };
}

/**
 * Score a candidate slot for a task with `tags` and an optional `deadline`,
 * in the persona's timezone (strategy §5 step 2):
 *   P_global(c) + Σ_tag P_tag(tag, c) − ρ · hoursUntilDeadline(c)
 * Higher is more preferred. The deadline term pulls crammers toward late slots.
 */
export function scoreSlot(
  field: PreferenceField,
  slot: Date,
  timezone: string,
  tags: string[],
  deadline: Date | null,
): number {
  const i = preferenceIndex(slot, timezone);
  let s = field.pGlobal[i] ?? 0;
  for (const t of tags) {
    const tg = field.pTag.get(t);
    if (tg) s += tg[i] ?? 0;
  }
  if (deadline) {
    const hours = (deadline.getTime() - slot.getTime()) / 3_600_000;
    // Procrastination: slots far from the deadline are penalised, so the
    // argmax drifts toward the deadline as ρ grows.
    s -= field.procrastination * Math.max(0, hours);
  }
  return s;
}
