/**
 * The five persona ARCHETYPES as parameter DISTRIBUTIONS (strategy §4.2).
 *
 * An archetype is a cluster: a set of distributions over latent parameters. A
 * Persona (`persona.factory.ts`) is a single seeded *draw* from one archetype,
 * with personal jitter, so members share traits but are never identical — that
 * intra-cluster variance is load-bearing for Phase-2 generalization and Phase-4
 * factorization.
 *
 * The numbers below are distribution CENTERS; per-persona values are sampled
 * around them. They are calibration defaults — the strategy doc's §11 calls for
 * fitting them from the real pilot; until then they encode the documented
 * temporal/tag signatures of each archetype.
 *
 * Two latent layers drive placement (kept deliberately separate, strategy §4.2):
 *  - `peaks` → the global temporal field `P_global(day, block)`.
 *  - `tagTimeInteractions` → per-tag deviations `P_tag(tag, block)` — the signal
 *    only a context-aware learner (Phase 3) can exploit, and the only reason
 *    Phase 3 can beat Phase 2 on replay. It MUST be present and distinct.
 */

export type ArchetypeId = "dev" | "night_owl" | "ops" | "pm" | "crammer";

/** A [mean, sd] pair sampled with a Gaussian. */
export type MeanSd = [number, number];

/**
 * A Gaussian bump on the 7×96 preference grid. `day` is an ISO weekday (1=Mon …
 * 7=Sun) or -1 for "every working day". `block` is the slot-of-day center
 * (0…95, i.e. 15-min blocks). `height` is the peak value; `spread` is the
 * std-dev in blocks (a wider, gentler hill vs a sharp peak).
 */
export interface PeakSpec {
  day: number; // ISO weekday, or -1 = all working days
  block: number; // 0…95 slot-of-day center
  height: number;
  spread: number; // blocks
}

/**
 * A tag×time interaction: for tasks carrying `tag`, the preference at `block`
 * (slot-of-day, all working days) is shifted by `delta`. Positive = the persona
 * prefers that tag at that time of day; negative = avoids it. This is the
 * Phase-3-only latent layer.
 */
export interface TagTimeInteraction {
  tag: string;
  block: number; // 0…95 slot-of-day center
  spread: number; // blocks
  delta: number;
}

export interface Archetype {
  id: ArchetypeId;
  label: string;
  /** Work window centers, minutes from midnight, + the ISO weekdays worked. */
  work: { start: MeanSd; end: MeanSd; days: number[] };
  /** A small spread of IANA zones to exercise the tz path. */
  timezones: string[];
  /** Global temporal field bumps (→ P_global). */
  peaks: PeakSpec[];
  /** Weighted tag mix the task generator samples from. */
  tagMix: { name: string; weight: number }[];
  /** Per-tag duration bias (actual ÷ estimated), lognormal in log-space. */
  tagBias: Record<string, { mu: MeanSd; sigma: MeanSd }>;
  /** Tag×time deviations (→ P_tag) — the Phase-3 signal. */
  tagTimeInteractions: TagTimeInteraction[];
  /** P(act on a mismatch). */
  editPropensity: MeanSd;
  /** Minimum preference gap before a move is worth it. */
  moveThreshold: MeanSd;
  /** Outcome simplex centers (normalised per persona). */
  discipline: { complete: number; reschedule: number; abandon: number };
  /** P(random / out-of-character action). */
  noiseFloor: MeanSd;
  /** Weight pulling preferred slots toward the deadline (crammers high). */
  procrastination: MeanSd;
  /** Probability a task carries an explicit deadline. */
  deadlineProb: MeanSd;
  /** Daily arrival volume center (tasks/working-day, pre-modulation). */
  dailyVolume: MeanSd;
  /** Day/week/month view sampling weights. */
  viewWeights: { day: number; week: number; month: number };
  /** Estimated-duration center per task (minutes), lognormal in log-space. */
  estDuration: { mu: MeanSd; sigma: MeanSd };
  /** Fixed/busy blocks per week (meetings for pm, on-call for ops). */
  fixedLoadPerWeek: MeanSd;
  /** Slow non-stationary drift applied per simulated month. */
  driftPerMonth: { peakShiftBlocks: number; biasDecay: number };
}

// Slot-of-day helper: a wall-clock hour → block index (4 blocks/hour).
const H = (hour: number, minute = 0) => hour * 4 + Math.floor(minute / 15);

export const ARCHETYPES: Archetype[] = [
  // ───────────────────────────── A · Steady 9–5 Developer ──────────────────
  {
    id: "dev",
    label: "Steady 9–5 Developer",
    work: { start: [540, 20], end: [1020, 20], days: [1, 2, 3, 4, 5] },
    timezones: ["Europe/Berlin", "Europe/Paris", "UTC"],
    peaks: [
      // Strong morning deep-work peak 09:30–12:00; post-lunch dip disliked.
      { day: -1, block: H(10, 30), height: 3.0, spread: 6 },
      { day: -1, block: H(14, 0), height: -1.0, spread: 4 },
    ],
    tagMix: [
      { name: "#backend", weight: 4 },
      { name: "#bugfix", weight: 3 },
      { name: "#review", weight: 2 },
      { name: "#meeting", weight: 1 },
    ],
    tagBias: {
      "#backend": { mu: [Math.log(1.32), 0.04], sigma: [0.18, 0.03] },
      "#bugfix": { mu: [Math.log(1.3), 0.04], sigma: [0.22, 0.03] },
      "#review": { mu: [Math.log(1.05), 0.03], sigma: [0.12, 0.02] },
    },
    tagTimeInteractions: [
      // Prefers #backend in the morning, tolerates #review in the afternoon.
      { tag: "#backend", block: H(10, 0), spread: 5, delta: 2.0 },
      { tag: "#review", block: H(15, 0), spread: 5, delta: 1.5 },
      { tag: "#review", block: H(10, 0), spread: 5, delta: -0.8 },
    ],
    editPropensity: [0.45, 0.08],
    moveThreshold: [1.2, 0.2],
    discipline: { complete: 0.8, reschedule: 0.15, abandon: 0.05 },
    noiseFloor: [0.1, 0.02],
    procrastination: [0.05, 0.02],
    deadlineProb: [0.4, 0.05],
    dailyVolume: [3.2, 0.6],
    viewWeights: { day: 0.5, week: 0.4, month: 0.1 },
    estDuration: { mu: [Math.log(75), 0.05], sigma: [0.45, 0.05] },
    fixedLoadPerWeek: [3, 1],
    driftPerMonth: { peakShiftBlocks: -0.4, biasDecay: 0.01 },
  },

  // ──────────────────────────── B · Night-Owl Builder ──────────────────────
  {
    id: "night_owl",
    label: "Night-Owl Builder",
    work: { start: [720, 30], end: [1200, 40], days: [1, 2, 3, 4, 5, 7] },
    timezones: ["America/New_York", "America/Los_Angeles", "UTC"],
    peaks: [
      // Strong late-afternoon/evening peak 16:00–20:00; mornings disliked.
      { day: -1, block: H(18, 0), height: 3.2, spread: 7 },
      { day: -1, block: H(12, 30), height: -1.2, spread: 5 },
    ],
    tagMix: [
      { name: "#frontend", weight: 4 },
      { name: "#design", weight: 3 },
      { name: "#sidequest", weight: 2 },
      { name: "#review", weight: 1 },
    ],
    tagBias: {
      "#frontend": { mu: [Math.log(1.15), 0.03], sigma: [0.15, 0.02] },
      "#design": { mu: [Math.log(1.12), 0.03], sigma: [0.18, 0.02] },
      "#sidequest": { mu: [Math.log(1.2), 0.04], sigma: [0.25, 0.03] },
    },
    tagTimeInteractions: [
      { tag: "#design", block: H(19, 0), spread: 5, delta: 1.6 },
      { tag: "#frontend", block: H(17, 0), spread: 6, delta: 1.4 },
    ],
    editPropensity: [0.55, 0.08],
    moveThreshold: [1.0, 0.2],
    discipline: { complete: 0.7, reschedule: 0.2, abandon: 0.1 },
    noiseFloor: [0.15, 0.03],
    procrastination: [0.1, 0.03],
    deadlineProb: [0.35, 0.05],
    dailyVolume: [3.0, 0.7],
    viewWeights: { day: 0.4, week: 0.45, month: 0.15 },
    estDuration: { mu: [Math.log(90), 0.05], sigma: [0.5, 0.05] },
    fixedLoadPerWeek: [2, 1],
    driftPerMonth: { peakShiftBlocks: 0.3, biasDecay: 0.005 },
  },

  // ─────────────────────── C · Interrupt-driven Ops/SRE ────────────────────
  {
    id: "ops",
    label: "Interrupt-driven Ops/SRE",
    work: { start: [480, 20], end: [1080, 30], days: [1, 2, 3, 4, 5, 6, 7] },
    timezones: ["Europe/London", "UTC", "Asia/Singapore"],
    peaks: [
      // Fragmented: mornings kept reactive (low pref), short midday focus.
      { day: -1, block: H(13, 0), height: 1.6, spread: 4 },
      { day: -1, block: H(9, 0), height: -1.4, spread: 4 },
    ],
    tagMix: [
      { name: "#incident", weight: 4 },
      { name: "#ops", weight: 3 },
      { name: "#oncall", weight: 2 },
      { name: "#review", weight: 1 },
    ],
    tagBias: {
      // Near-unbiased center but HIGH variance (σ large) — the discriminating
      // persona for the blend-vs-max-bias ablation.
      "#incident": { mu: [Math.log(1.0), 0.05], sigma: [0.45, 0.05] },
      "#ops": { mu: [Math.log(1.02), 0.05], sigma: [0.4, 0.05] },
      "#oncall": { mu: [Math.log(1.0), 0.05], sigma: [0.5, 0.06] },
    },
    tagTimeInteractions: [
      { tag: "#incident", block: H(13, 0), spread: 3, delta: 0.8 },
      { tag: "#ops", block: H(11, 0), spread: 4, delta: 0.6 },
    ],
    editPropensity: [0.65, 0.08],
    moveThreshold: [0.8, 0.2],
    discipline: { complete: 0.5, reschedule: 0.4, abandon: 0.1 },
    noiseFloor: [0.25, 0.04],
    procrastination: [0.08, 0.03],
    deadlineProb: [0.5, 0.06],
    dailyVolume: [5.0, 1.2],
    viewWeights: { day: 0.7, week: 0.25, month: 0.05 },
    // Many short tasks.
    estDuration: { mu: [Math.log(35), 0.05], sigma: [0.55, 0.06] },
    fixedLoadPerWeek: [5, 2],
    driftPerMonth: { peakShiftBlocks: 0.2, biasDecay: 0.0 },
  },

  // ───────────────────────────── D · Meeting-heavy PM ──────────────────────
  {
    id: "pm",
    label: "Meeting-heavy PM",
    work: { start: [540, 20], end: [1080, 20], days: [1, 2, 3, 4, 5] },
    timezones: ["Europe/Berlin", "America/New_York", "UTC"],
    peaks: [
      // Focus early (08:00–09:30) or late (16:30–18:00); midday meeting band.
      { day: -1, block: H(9, 0), height: 2.2, spread: 4 },
      { day: -1, block: H(17, 0), height: 2.0, spread: 4 },
      { day: -1, block: H(12, 30), height: -1.6, spread: 6 },
    ],
    tagMix: [
      { name: "#planning", weight: 3 },
      { name: "#1on1", weight: 3 },
      { name: "#review", weight: 2 },
      { name: "#writing", weight: 2 },
    ],
    tagBias: {
      // Overestimates (optimistic blocking): actual < estimated.
      "#planning": { mu: [Math.log(0.85), 0.03], sigma: [0.15, 0.02] },
      "#1on1": { mu: [Math.log(0.88), 0.03], sigma: [0.12, 0.02] },
      "#writing": { mu: [Math.log(0.9), 0.03], sigma: [0.18, 0.02] },
    },
    tagTimeInteractions: [
      // Prefers #writing early, #1on1 midday — a strong P_tag interaction.
      { tag: "#writing", block: H(8, 30), spread: 4, delta: 1.8 },
      { tag: "#1on1", block: H(13, 0), spread: 4, delta: 1.6 },
      { tag: "#writing", block: H(13, 0), spread: 4, delta: -1.0 },
    ],
    editPropensity: [0.45, 0.08],
    moveThreshold: [1.1, 0.2],
    discipline: { complete: 0.65, reschedule: 0.25, abandon: 0.1 },
    noiseFloor: [0.15, 0.03],
    procrastination: [0.07, 0.03],
    deadlineProb: [0.45, 0.05],
    dailyVolume: [3.5, 0.7],
    viewWeights: { day: 0.35, week: 0.45, month: 0.2 },
    estDuration: { mu: [Math.log(60), 0.05], sigma: [0.4, 0.05] },
    // Many fixed blocks.
    fixedLoadPerWeek: [10, 3],
    driftPerMonth: { peakShiftBlocks: 0.1, biasDecay: 0.01 },
  },

  // ──────────────────── E · Deadline-crammer Student/Researcher ────────────
  {
    id: "crammer",
    label: "Deadline-crammer Student/Researcher",
    work: { start: [600, 40], end: [1320, 40], days: [1, 2, 3, 4, 5, 6, 7] },
    timezones: ["Europe/Madrid", "America/Sao_Paulo", "UTC"],
    peaks: [
      // Strong evening peak; bursty. (Deadline pull is added separately via ρ.)
      { day: -1, block: H(20, 0), height: 2.6, spread: 8 },
      { day: -1, block: H(11, 0), height: -0.8, spread: 6 },
    ],
    tagMix: [
      { name: "#writing", weight: 4 },
      { name: "#reading", weight: 3 },
      { name: "#analysis", weight: 2 },
      { name: "#review", weight: 1 },
    ],
    tagBias: {
      // Large underestimate on #writing.
      "#writing": { mu: [Math.log(1.6), 0.05], sigma: [0.3, 0.04] },
      "#reading": { mu: [Math.log(1.3), 0.04], sigma: [0.28, 0.04] },
      "#analysis": { mu: [Math.log(1.45), 0.05], sigma: [0.32, 0.04] },
    },
    tagTimeInteractions: [
      { tag: "#writing", block: H(21, 0), spread: 6, delta: 1.4 },
      { tag: "#reading", block: H(15, 0), spread: 6, delta: 0.9 },
    ],
    editPropensity: [0.35, 0.08],
    moveThreshold: [1.3, 0.2],
    // Bursty: high abandon early, high complete near deadline (modulated at
    // outcome time by deadline pressure).
    discipline: { complete: 0.55, reschedule: 0.2, abandon: 0.25 },
    noiseFloor: [0.2, 0.04],
    procrastination: [0.4, 0.08],
    deadlineProb: [0.7, 0.06],
    dailyVolume: [2.8, 1.0],
    viewWeights: { day: 0.2, week: 0.5, month: 0.3 },
    estDuration: { mu: [Math.log(110), 0.05], sigma: [0.55, 0.06] },
    fixedLoadPerWeek: [1, 1],
    driftPerMonth: { peakShiftBlocks: -0.2, biasDecay: 0.02 },
  },
];

/**
 * Deliberately UNEQUAL cluster sizes (real populations are) — ~40–60 personas
 * across the five archetypes (strategy §4.1). Scaled down by `--days` smoke runs
 * via the runner, never here.
 */
export const POPULATION: { archetype: ArchetypeId; count: number }[] = [
  { archetype: "dev", count: 12 },
  { archetype: "night_owl", count: 10 },
  { archetype: "ops", count: 8 },
  { archetype: "pm", count: 11 },
  { archetype: "crammer", count: 9 },
];

export function archetypeById(id: ArchetypeId): Archetype {
  const a = ARCHETYPES.find((x) => x.id === id);
  if (!a) throw new Error(`Unknown archetype: ${id}`);
  return a;
}
