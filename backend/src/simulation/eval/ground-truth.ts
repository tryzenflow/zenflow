import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Persona } from "../personas/persona.factory";
import type { ArchetypeId } from "../personas/archetypes";

/**
 * Ground-truth export (strategy §13 Step 5, "the simulation-only luxury", and the
 * Phase-2 eval Step 0). Each persona's HIDDEN latent fields are kept in-memory
 * only and never written to a `User` column a learner could read
 * (anti-circularity, strategy §1.1 / §10.3). But to *score recovery* — does the
 * learned `preferenceMatrix` converge toward the persona's true `pGlobal`, do the
 * estimated per-tag biases approach the true `b_tag` — the eval needs those true
 * values. This writes them to a SIDECAR JSON alongside the run, keyed by the real
 * `userId`, as the out-of-band channel the eval reads.
 *
 * Why captured during the run (not regenerated standalone): `userId` is a
 * non-deterministic `randomUUID()` minted at run time (`persona.factory.ts`,
 * `batched/engine.ts`), so the same seed produces the same latent fields but
 * DIFFERENT ids — there is no way to regenerate ground truth and join it back to
 * the DB rows. It must be emitted by the same run that writes the DB.
 *
 * Drift note: the reaction model now scores against a DRIFTED field — the runner
 * advances `driftPGlobal` by `peakShiftBlocks × (day / 30)` at each placement
 * decision (`runner.ts` via `driftedFieldFor`), so `driftPerMonth` /
 * `--drift-mult` is a live sensitivity axis rather than a no-op. The exported
 * `pGlobal` below is still the BASE (day-0, un-drifted) field — the recovery
 * target a Phase-2 matrix can approximate at span start — and `driftPerMonth` is
 * exported alongside it so a drift-aware recovery variant can reconstruct the
 * field at any later day as `driftPGlobal(pGlobal, peakShiftBlocks × monthsAt(d))`.
 */

/** Round to 6 decimals to keep the sidecar compact without losing recovery precision. */
function r6(x: number): number {
  return Math.round(x * 1e6) / 1e6;
}

/** Per-persona ground truth the recovery metrics score against. */
export interface PersonaGroundTruth {
  userId: string;
  index: number;
  /** Analysis grouping key (cohort slicing); a Phase-4 product concern, not Phase-2. */
  archetypeId: ArchetypeId;
  prefs: {
    workStart: number;
    workEnd: number;
    workDays: number[];
    timezone: string;
  };
  /** The true global temporal field (7×24 = 168 cells) — Phase-2 placement target. */
  pGlobal: number[];
  /**
   * Per-tag duration bias: `mu`/`sigma` are lognormal params (log-space); `bias`
   * is the multiplicative center `exp(mu)` (actual ÷ estimated) the Phase-2
   * corrector estimates.
   */
  tagBias: Record<string, { mu: number; sigma: number; bias: number }>;
  /** Slow non-stationary drift (dormant today; kept for a drifted-recovery variant). */
  driftPerMonth: { peakShiftBlocks: number; biasDecay: number };
  /**
   * Task IDs that were urgency-moved during the simulation run (§5.6).
   * Used by `computeMetrics` to decompose MAR into avoidable vs unavoidable.
   * A MOVE for a task in this set is `MAR_unavoidable`; all others are `MAR_avoidable`.
   */
  urgencyMovedTaskIds: string[];
}

export interface GroundTruthFile {
  meta: {
    seed: number;
    start: string;
    days: number;
    mode: string;
    personas: number;
    /** Schema marker so the eval can validate what it loaded. */
    kind: "phase-2-ground-truth";
  };
  personas: PersonaGroundTruth[];
}

/**
 * Project a live {@link Persona} to its serialisable ground truth.
 *
 * @param urgencyMovedIds - Task IDs that received an urgency-spike MOVE during
 *   the run. Pass the set collected by the drive loop; defaults to empty (no
 *   urgency decomposition available for this persona).
 */
export function toGroundTruth(
  persona: Persona,
  urgencyMovedIds: Set<string> = new Set(),
): PersonaGroundTruth {
  const tagBias: PersonaGroundTruth["tagBias"] = {};
  for (const [tag, b] of persona.tagBias) {
    tagBias[tag] = {
      mu: r6(b.mu),
      sigma: r6(b.sigma),
      bias: r6(Math.exp(b.mu)),
    };
  }
  return {
    userId: persona.userId,
    index: persona.index,
    archetypeId: persona.archetypeId,
    prefs: { ...persona.prefs, workDays: [...persona.prefs.workDays] },
    pGlobal: Array.from(persona.field.pGlobal, r6),
    tagBias,
    driftPerMonth: { ...persona.driftPerMonth },
    urgencyMovedTaskIds: Array.from(urgencyMovedIds),
  };
}

/** Conventional sidecar path for a run, under `<cwd>/sim-output/`. */
export function groundTruthPath(seed: number, days: number): string {
  return join(
    process.cwd(),
    "sim-output",
    `ground-truth-seed${seed}-days${days}.json`,
  );
}

/** Write the ground-truth sidecar; creates the parent dir. Returns the path. */
export async function writeGroundTruthFile(
  path: string,
  file: GroundTruthFile,
): Promise<string> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(file), "utf8");
  return path;
}

/** Load a ground-truth sidecar (used by the recovery metrics in later phases). */
export async function loadGroundTruthFile(
  path: string,
): Promise<GroundTruthFile> {
  const raw = await readFile(path, "utf8");
  const parsed = JSON.parse(raw) as GroundTruthFile;
  if (parsed?.meta?.kind !== "phase-2-ground-truth") {
    throw new Error(`Not a ground-truth sidecar: ${path}`);
  }
  return parsed;
}
