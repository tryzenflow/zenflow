import type { CreateTaskInput, ViewMode } from "@zenflow/shared";
import { round15, type Rng } from "../rng";
import type { Persona } from "../personas/persona.factory";
import type { SimClock } from "../clock";

/**
 * Per-persona daily task stream (strategy §6, §7).
 *
 * Pure: given a persona, a day index, the clock, and a seeded `rng`, it emits
 * 0…N task specs. Each spec is a `CreateTaskInput`-shaped payload PLUS the hidden
 * `trueDurationMinutes` (the persona's real duration the reaction model resizes
 * toward) and the `arrivalMinute` (when in the day it arrives). No I/O.
 *
 * The hidden `trueDurationMinutes` is the only field the generator emits that the
 * service never sees — it is the duration-channel ground truth (strategy §5.2).
 *
 * Tag diversity is deliberate: a persona's `tagMix` carries the LEARNABLE signal
 * (bias + P_tag), but real users also attach a long tail of cross-cutting tags
 * with NO signal ({@link GLOBAL_TAGS}) and occasional out-of-profile work. Those
 * are pure noise — they have no `tagBias`/`P_tag` entry, so the duration and
 * preference channels treat them as neutral, and the learner must separate signal
 * tags from noise. {@link RARE_EVENTS} add infrequent, bursty, out-of-rhythm tasks
 * (interruptions, one-off big efforts) so the stream isn't a clean periodic signal.
 */

export interface TaskSpec {
  input: CreateTaskInput;
  /** The persona's REAL duration (minutes, grid-aligned) — never sent at create. */
  trueDurationMinutes: number;
  /** Minute-of-day the task arrives (drives the create `now`). */
  arrivalMinute: number;
  /** The tag names on this task (mirror of input.tags, for the reaction model). */
  tags: string[];
}

/**
 * Cross-cutting tags ANY persona may attach — pure noise (no bias, no P_tag).
 * A realistic, messy vocabulary so tasks carry varied multi-tag combinations and
 * the learner faces co-occurrence noise rather than 4 clean labels.
 */
const GLOBAL_TAGS = [
  // process / comms
  "email",
  "slack",
  "standup",
  "sync",
  "retro",
  "docs",
  "notes",
  "admin",
  "planning",
  // work-type
  "refactor",
  "testing",
  "deploy",
  "research",
  "spike",
  "prototype",
  "debugging",
  "pairing",
  "release",
  "chore",
  // context / status
  "urgent",
  "blocked",
  "followup",
  "wip",
  "quickwin",
  "techdebt",
  "customer",
  "support",
  // growth / misc
  "learning",
  "reading",
  "interview",
  "hiring",
  "onboarding",
  "misc",
];

/**
 * Sample 1–3 tags. The PRIMARY tag is the persona's signal (rarely off-profile);
 * EXTRA tags are drawn ~half from the persona mix and ~half from the global noise
 * pool, producing varied, realistic combinations.
 */
function sampleTags(persona: Persona, rng: Rng): string[] {
  const names = persona.tagMix.map((t) => t.name);
  const weights = persona.tagMix.map((t) => t.weight);
  const out = new Set<string>();

  // Primary: usually the persona's signal; ~6% an off-profile global tag.
  out.add(rng.bool(0.06) ? rng.pick(GLOBAL_TAGS) : rng.weighted(names, weights));

  // 0–2 extras, mostly 0–1, each split between persona mix and the noise pool.
  const extras = rng.weighted([0, 1, 2], [5, 4, 2]);
  for (let i = 0; i < extras; i++) {
    out.add(rng.bool(0.5) ? rng.pick(GLOBAL_TAGS) : rng.weighted(names, weights));
  }
  return Array.from(out);
}

/**
 * Over-dispersed daily count: a gamma-mixed Poisson (negative-binomial-ish),
 * scaled by weekday rhythm × sprint phase × seasonality. Weekends near-zero
 * unless the persona works them.
 */
function dailyCount(
  persona: Persona,
  clock: SimClock,
  day: number,
  rng: Rng,
): number {
  const weekday = clock.isoWeekday(day);
  const worksToday = persona.prefs.workDays.includes(weekday);
  // Weekday rhythm: Mon/Tue heavier, Fri lighter, weekend near-zero.
  const weekdayFactor =
    weekday === 1 || weekday === 2
      ? 1.2
      : weekday === 5
        ? 0.8
        : weekday >= 6
          ? worksToday
            ? 0.4
            : 0.05
          : 1.0;
  // Sprint phase: volume spikes near the 2-week cycle end.
  const sp = clock.sprintPhase(day);
  const sprintFactor = 0.8 + 0.6 * sp;
  // Warmup is lighter (learners idle, baseline collection).
  const phaseFactor = clock.phase(day) === "warmup" ? 0.5 : 1.0;
  const season = clock.seasonality(day);

  const lambda =
    persona.dailyVolume * weekdayFactor * sprintFactor * phaseFactor * season;
  // Gamma-mix the rate (over-dispersion) then Poisson-sample the count.
  const dispersed = lambda * rng.lognormal(0, 0.35);
  return rng.poisson(Math.max(0, dispersed));
}

/** Sample a view from the persona's day/week/month weights. */
function sampleView(persona: Persona, rng: Rng): ViewMode {
  const { day, week, month } = persona.viewWeights;
  return rng.weighted<ViewMode>(["day", "week", "month"], [day, week, month]);
}

/**
 * Sample a deadline horizon for a task arriving on `day` (strategy §7): tight
 * near cycle ends for high-procrastination personas, looser otherwise. Returns
 * an ISO string or null. The deadline lands at end-of-day of `day + horizon`.
 */
function sampleDeadline(
  persona: Persona,
  clock: SimClock,
  day: number,
  rng: Rng,
): string | null {
  if (!rng.bool(persona.deadlineProb)) return null;
  const sp = clock.sprintPhase(day);
  // Closer to cycle end → tighter horizon. Procrastinators get tighter windows.
  const base = persona.procrastination > 0.2 ? 3 : 7;
  const horizon = Math.max(1, Math.round(base * (1.1 - sp) + rng.normal(0, 1)));
  return deadlineAt(persona, clock, day + horizon);
}

/** End-of-working-day deadline ISO for an absolute day index, in the persona tz. */
function deadlineAt(persona: Persona, clock: SimClock, day: number): string {
  return clock
    .at(day, persona.prefs.workEnd, persona.prefs.timezone)
    .toISOString();
}

/** Per-tag estimated duration, then a separate true duration via the tag bias. */
function sampleDurations(
  persona: Persona,
  tags: string[],
  rng: Rng,
): { est: number; trueDur: number } {
  // Estimate from the persona's global est distribution.
  const est = round15(
    rng.lognormal(persona.estDuration.mu, persona.estDuration.sigma),
  );
  // True duration = est × tag bias × lognoise. Use the strongest-biased tag.
  let logBias = 0;
  let noiseSigma = 0.12;
  for (const t of tags) {
    const b = persona.tagBias.get(t);
    if (b && Math.abs(b.mu) > Math.abs(logBias)) {
      logBias = b.mu;
      noiseSigma = b.sigma;
    }
  }
  const factor = Math.exp(logBias + rng.normal(0, noiseSigma));
  const trueDur = round15(est * factor);
  return { est, trueDur };
}

const VERBS = [
  "Work on",
  "Finish",
  "Draft",
  "Review",
  "Investigate",
  "Refactor",
  "Plan",
  "Sync on",
  "Prep",
  "Debug",
  "Write up",
  "Polish",
  "Scope",
  "Follow up on",
  "Triage",
  "Wrap up",
];

const OBJECTS = [
  "the auth flow",
  "the dashboard",
  "the API",
  "the migration",
  "the report",
  "the roadmap",
  "the test suite",
  "the deploy",
  "the proposal",
  "the backlog",
  "the spec",
  "the integration",
  "the onboarding flow",
  "the design",
  "the release notes",
  "the metrics",
];

/** Varied title: a verb + (usually) the lead tag, sometimes a generic object. */
function title(tags: string[], rng: Rng): string {
  const verb = rng.pick(VERBS);
  const subject = rng.bool(0.6) ? (tags[0] ?? "the task") : rng.pick(OBJECTS);
  return `${verb} ${subject}`;
}

/**
 * Infrequent, out-of-rhythm task templates (interruptions + one-off big efforts).
 * Tags are often OFF-PROFILE — the point is that real schedules get surprised.
 * `deadlineDays` is the horizon from the arrival day (0 = same day, null = none);
 * the duration is drawn in [durMin, durMax] and is its OWN true duration noise
 * source (these break the persona's normal duration distribution on purpose).
 */
interface RareEvent {
  tags: string[];
  durMin: number;
  durMax: number;
  deadlineDays: number | null;
  weight: number;
}

const RARE_EVENTS: RareEvent[] = [
  { tags: ["incident", "urgent"], durMin: 30, durMax: 120, deadlineDays: 0, weight: 3 },
  { tags: ["escalation", "customer"], durMin: 30, durMax: 90, deadlineDays: 1, weight: 2 },
  { tags: ["outage", "oncall"], durMin: 60, durMax: 180, deadlineDays: 0, weight: 1 },
  { tags: ["interview", "hiring"], durMin: 45, durMax: 60, deadlineDays: 2, weight: 2 },
  { tags: ["offsite", "planning"], durMin: 180, durMax: 360, deadlineDays: 5, weight: 1 },
  { tags: ["deepwork", "project"], durMin: 180, durMax: 300, deadlineDays: 7, weight: 2 },
  { tags: ["audit", "compliance"], durMin: 60, durMax: 150, deadlineDays: 4, weight: 1 },
  { tags: ["demo", "customer"], durMin: 30, durMax: 90, deadlineDays: 2, weight: 1 },
];

/** Build one rare/sudden task spec (off-profile tags, own duration/deadline). */
function makeRareSpec(
  persona: Persona,
  clock: SimClock,
  day: number,
  rng: Rng,
): TaskSpec {
  const ev = rng.weighted(
    RARE_EVENTS,
    RARE_EVENTS.map((e) => e.weight),
  );
  const est = round15(ev.durMin + rng.int(ev.durMax - ev.durMin + 1));
  // Neutral-ish realized duration (these tags carry no learned bias).
  const trueDur = round15(est * Math.exp(rng.normal(0, 0.2)));
  const deadline =
    ev.deadlineDays === null ? null : deadlineAt(persona, clock, day + ev.deadlineDays);
  const span = Math.max(60, persona.prefs.workEnd - persona.prefs.workStart);
  const arrivalMinute = Math.floor(persona.prefs.workStart + rng.next() * span);
  const tags = [...ev.tags];
  return {
    input: {
      title: title(tags, rng),
      durationMinutes: est,
      deadline,
      tags,
      view: sampleView(persona, rng),
      startDate: clock.dateStr(day),
      fixed: false,
    },
    trueDurationMinutes: trueDur,
    arrivalMinute,
    tags,
  };
}

/** Build one ordinary task spec from the persona's signal + noise tags. */
function makeNormalSpec(
  persona: Persona,
  clock: SimClock,
  day: number,
  rng: Rng,
): TaskSpec {
  const tags = sampleTags(persona, rng);
  const view = sampleView(persona, rng);
  const deadline = sampleDeadline(persona, clock, day, rng);
  const { est, trueDur } = sampleDurations(persona, tags, rng);
  const span = Math.max(60, persona.prefs.workEnd - persona.prefs.workStart);
  const arrivalMinute = Math.floor(persona.prefs.workStart + rng.next() * span);
  return {
    input: {
      title: title(tags, rng),
      durationMinutes: est,
      deadline,
      tags,
      view,
      startDate: clock.dateStr(day),
      fixed: false,
    },
    trueDurationMinutes: trueDur,
    arrivalMinute,
    tags,
  };
}

/** Emit the day's task specs for a persona (empty on idle/zero-volume days). */
export function generateTasksForDay(
  persona: Persona,
  clock: SimClock,
  day: number,
  rng: Rng,
): TaskSpec[] {
  let count = dailyCount(persona, clock, day, rng);

  // Sudden busy day: a rare surge of extra ordinary tasks on top of the base.
  if (rng.bool(0.03)) count += 2 + rng.poisson(3);

  const specs: TaskSpec[] = [];
  for (let i = 0; i < count; i++)
    specs.push(makeNormalSpec(persona, clock, day, rng));

  // Infrequent interruption(s): an out-of-rhythm rare task, occasionally two.
  if (rng.bool(0.06)) {
    specs.push(makeRareSpec(persona, clock, day, rng));
    if (rng.bool(0.15)) specs.push(makeRareSpec(persona, clock, day, rng));
  }

  // Arrivals in chronological order within the day.
  specs.sort((a, b) => a.arrivalMinute - b.arrivalMinute);
  return specs;
}
