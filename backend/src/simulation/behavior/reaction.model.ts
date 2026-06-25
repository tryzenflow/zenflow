import type { Rng } from "../rng";
import type { Persona } from "../personas/persona.factory";
import { scoreSlot, type PreferenceField } from "../personas/preference-field";

/**
 * The probabilistic, feasibility-bounded reaction policy (strategy §5).
 *
 * Pure: every decision is a function of the persona's hidden field, the task, the
 * EDF-feasible set, and a seeded `rng`. It NEVER touches Prisma or the clock —
 * the runner obtains the feasible set from the pure `feasibleSlots` and applies
 * the returned decision through the real services.
 *
 * The feasibility wall (strategy §2) holds for free: every slot the placement
 * channel can return is drawn from `feasible` only, so a tight-deadline task
 * forces acceptance of a non-preferred slot — a legitimate MAR contribution no
 * learner can remove.
 */

export interface ReactionTask {
  tags: string[];
  deadline: Date | null;
  durationMinutes: number;
  trueDurationMinutes: number;
}

const ARGMAX_JITTER = 0.1; // humans aren't perfect optimizers (strategy §5.2)

/**
 * Placement channel → MOVE / KEEP (strategy §5.1). Returns the slot to move to,
 * or `null` to KEEP the suggestion. The result is always a member of `feasible`
 * (or null), so it can never violate the feasibility wall.
 *
 * `field` is the latent preference field the persona scores against. It defaults
 * to `persona.field` (the base, un-drifted ground truth). The runner passes a
 * DRIFTED copy (`driftPGlobal` advanced by the elapsed months) so non-stationary
 * drift (`driftPerMonth` / `--drift-mult`) actually reaches the reaction loop —
 * previously the model always scored against the base field, so drift was a
 * dormant no-op. Drift is a pure function of elapsed time (no RNG), so passing it
 * here leaves the seeded random stream byte-for-byte unchanged: a drift-mult=1
 * run with archetypes that carry drift differs only by the drift itself, and a
 * persona with zero drift reproduces the previous behaviour exactly.
 */
export function decidePlacement(
  persona: Persona,
  task: ReactionTask,
  suggested: Date,
  feasible: Date[],
  rng: Rng,
  field: PreferenceField = persona.field,
): Date | null {
  if (feasible.length === 0) return null;

  const score = (c: Date) =>
    scoreSlot(field, c, persona.prefs.timezone, task.tags, task.deadline);

  // Noise floor: an out-of-character action regardless of preference. May land
  // on the suggestion itself (→ effectively a KEEP), which is correct — even
  // random behaviour sometimes agrees with the engine.
  if (rng.bool(persona.noiseFloor)) {
    const c = rng.pick(feasible);
    return sameInstant(c, suggested) ? null : c;
  }

  // Preferred feasible slot, with small Gaussian argmax jitter.
  let best = feasible[0];
  let bestScore = -Infinity;
  for (const c of feasible) {
    const s = score(c) + rng.normal(0, ARGMAX_JITTER);
    if (s > bestScore) {
      bestScore = s;
      best = c;
    }
  }

  const gap = score(best) - score(suggested);
  const worthIt =
    gap > persona.moveThreshold &&
    !sameInstant(best, suggested) &&
    rng.bool(persona.editPropensity);
  return worthIt ? best : null;
}

/**
 * Duration channel → whether to RESIZE (strategy §5.2). Resize when the mismatch
 * between the persona's true duration and the estimate exceeds one slot AND the
 * edit propensity fires. Returns the new duration, or null to leave it.
 */
export function decideResize(
  persona: Persona,
  task: ReactionTask,
  rng: Rng,
): number | null {
  if (Math.abs(task.trueDurationMinutes - task.durationMinutes) < 15)
    return null;
  if (!rng.bool(persona.editPropensity)) return null;
  return task.trueDurationMinutes;
}

export type Outcome = "complete" | "reschedule" | "abandon";

/**
 * Outcome channel → COMPLETE / reschedule(MOVE) / ABANDON (strategy §5.3).
 * Draws from the persona's discipline simplex, modulated by:
 *  - deadline pressure: as the deadline nears, `complete` rises (crammers cram),
 *  - fatigue: a recent heavy load raises `reschedule` for the next task.
 * The actual ABANDON write is the production overdue sweep; here "abandon" means
 * the persona does nothing and lets the slot lapse.
 */
export function decideOutcome(
  persona: Persona,
  task: { deadline: Date | null },
  now: Date,
  fatigue: number, // 0…1, recent-load pressure
  rng: Rng,
): Outcome {
  let { complete, reschedule, abandon } = persona.discipline;

  if (task.deadline) {
    const hours = (task.deadline.getTime() - now.getTime()) / 3_600_000;
    if (hours <= 24) {
      // Crunch: completion rises sharply, abandon falls.
      const pressure = Math.min(1, (24 - hours) / 24);
      complete += pressure * 0.5;
      abandon = Math.max(0.01, abandon - pressure * 0.4);
    } else if (hours > 72) {
      // Far off: more likely to let it ride (reschedule) or drop early.
      reschedule += 0.15;
      abandon += 0.1;
    }
  }

  // Fatigue raises the chance of pushing the next task.
  reschedule += fatigue * 0.3;

  const total = complete + reschedule + abandon;
  return rng.weighted<Outcome>(
    ["complete", "reschedule", "abandon"],
    [complete / total, reschedule / total, abandon / total],
  );
}

function sameInstant(a: Date, b: Date): boolean {
  return a.getTime() === b.getTime();
}
