import type { PrismaService } from "../../prisma/prisma.service";
import type { User } from "../../../generated/prisma";
import { makeRng, round15, type Rng } from "../rng";
import { buildPreferenceField, type PreferenceField } from "./preference-field";
import type { Archetype, ArchetypeId, MeanSd } from "./archetypes";

/**
 * Sample a {@link Persona} from an {@link Archetype} and seed its `User` + `Tag`
 * rows. This is the ONE place the simulator persists state directly (rows the
 * real services then drive); everything downstream goes through TasksService /
 * SchedulerService.
 *
 * Anti-circularity (strategy §1.1, §10.3): the archetype ground-truth label
 * lives ONLY in the in-memory Persona (and the out-of-band labels output the
 * eval harness reads) — never in a `User` column a learner reads. `User.
 * roleArchetypeId` is left null here; Phase-4 cold-start is what fills it, and
 * recovery would be circular if we pre-wrote it.
 */
export interface Persona {
  userId: string;
  /** GROUND TRUTH for Phase-4 recovery — kept in-memory only, never in the DB. */
  archetypeId: ArchetypeId;
  index: number; // population index, also the per-persona seed key
  prefs: {
    workStart: number;
    workEnd: number;
    workDays: number[];
    timezone: string;
  };
  /** The hidden placement field (P_global + P_tag) + ρ. */
  field: PreferenceField;
  /** Per-tag duration bias parameters (actual ÷ estimated), lognormal. */
  tagBias: Map<string, { mu: number; sigma: number }>;
  /** Reaction-policy scalars (strategy §4.3). */
  editPropensity: number;
  moveThreshold: number;
  noiseFloor: number;
  procrastination: number;
  discipline: { complete: number; reschedule: number; abandon: number };
  deadlineProb: number;
  dailyVolume: number;
  viewWeights: { day: number; week: number; month: number };
  estDuration: { mu: number; sigma: number };
  fixedLoadPerWeek: number;
  driftPerMonth: { peakShiftBlocks: number; biasDecay: number };
  /** Weighted tag mix (names + weights) the generator samples from. */
  tagMix: { name: string; weight: number }[];
  /** Idle windows (vacations/sick days) as [startDay, endDay] inclusive. */
  idleWindows: [number, number][];
}

const draw = (rng: Rng, [mean, sd]: MeanSd) => rng.normal(mean, sd);
const drawClamped = (rng: Rng, ms: MeanSd, min: number, max: number) =>
  Math.min(max, Math.max(min, draw(rng, ms)));

/** Normalise a discipline simplex to sum 1. */
function normaliseSimplex(
  d: { complete: number; reschedule: number; abandon: number },
  rng: Rng,
): { complete: number; reschedule: number; abandon: number } {
  // Per-persona jitter, then renormalise.
  const c = Math.max(0.01, d.complete * (1 + rng.normal(0, 0.1)));
  const r = Math.max(0.01, d.reschedule * (1 + rng.normal(0, 0.1)));
  const a = Math.max(0.01, d.abandon * (1 + rng.normal(0, 0.1)));
  const t = c + r + a;
  return { complete: c / t, reschedule: r / t, abandon: a / t };
}

/**
 * Sample idle windows over the span: 1–2 vacations of 5–10 contiguous days plus
 * a few one-off sick days. Pure (seeded). Holidays are population-wide and
 * applied by the runner, not here.
 */
function sampleIdleWindows(rng: Rng, spanDays: number): [number, number][] {
  const out: [number, number][] = [];
  const vacations = 1 + rng.int(2);
  for (let i = 0; i < vacations; i++) {
    const len = 5 + rng.int(6);
    const start = rng.int(Math.max(1, spanDays - len));
    out.push([start, start + len - 1]);
  }
  const sickDays = rng.int(4);
  for (let i = 0; i < sickDays; i++) {
    const d = rng.int(spanDays);
    out.push([d, d]);
  }
  return out;
}

/** Build the in-memory Persona from a seeded draw of the archetype. */
export function buildPersona(
  user: User,
  a: Archetype,
  rng: Rng,
  index: number,
  spanDays: number,
): Persona {
  const procrastination = Math.max(0, draw(rng, a.procrastination));
  const tagBias = new Map<string, { mu: number; sigma: number }>();
  for (const [name, b] of Object.entries(a.tagBias)) {
    tagBias.set(name, {
      mu: draw(rng, b.mu),
      sigma: Math.max(0.01, draw(rng, b.sigma)),
    });
  }

  return {
    userId: user.id,
    archetypeId: a.id,
    index,
    prefs: {
      workStart: user.workStart,
      workEnd: user.workEnd,
      workDays: user.workDays,
      timezone: user.timezone,
    },
    field: buildPreferenceField(a, rng, procrastination),
    tagBias,
    editPropensity: drawClamped(rng, a.editPropensity, 0, 1),
    moveThreshold: Math.max(0, draw(rng, a.moveThreshold)),
    noiseFloor: drawClamped(rng, a.noiseFloor, 0, 1),
    procrastination,
    discipline: normaliseSimplex(a.discipline, rng),
    deadlineProb: drawClamped(rng, a.deadlineProb, 0, 1),
    dailyVolume: Math.max(0.2, draw(rng, a.dailyVolume)),
    viewWeights: a.viewWeights,
    estDuration: {
      mu: draw(rng, a.estDuration.mu),
      sigma: Math.max(0.05, draw(rng, a.estDuration.sigma)),
    },
    fixedLoadPerWeek: Math.max(0, draw(rng, a.fixedLoadPerWeek)),
    driftPerMonth: a.driftPerMonth,
    tagMix: a.tagMix,
    idleWindows: sampleIdleWindows(rng, spanDays),
  };
}

/**
 * Draw a persona's latent params (seeded, reproducible) and persist its `User` +
 * `Tag` rows. `preferenceMatrix` is left `[]` so the real `applyPreference` path
 * seeds it lazily — the Phase-2 signal must come through the service, not be
 * pre-written.
 */
export async function seedPersona(
  prisma: PrismaService,
  a: Archetype,
  seed: number,
  index: number,
  spanDays: number,
): Promise<Persona> {
  const rng = makeRng(seed);
  const timezone = rng.pick(a.timezones);
  const workStart = round15(draw(rng, a.work.start));
  const workEnd = round15(draw(rng, a.work.end));
  // Optionally add/drop a work day for intra-cluster variance.
  const workDays = [...a.work.days];
  if (rng.bool(0.15) && workDays.length > 1) workDays.pop();

  const user = await prisma.user.create({
    data: {
      name: `${a.label} #${index}`,
      email: `sim-${a.id}-${index}-${seed}@zenflow.sim`,
      timezone,
      workStart,
      workEnd,
      workDays,
      onboardingComplete: true,
      // preferenceMatrix left []: seeded lazily by the real applyPreference path.
      roleArchetypeId: null, // Phase-4 cold-start fills this; ground truth lives in Persona.
    },
  });

  const tagNames = Array.from(new Set(a.tagMix.map((t) => t.name)));
  await prisma.tag.createMany({
    data: tagNames.map((name) => ({ userId: user.id, name })),
    skipDuplicates: true,
  });

  return buildPersona(user, a, rng, index, spanDays);
}
