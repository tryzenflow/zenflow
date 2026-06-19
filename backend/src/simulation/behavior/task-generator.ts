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

/** Sample 1–3 tags from the persona's weighted mix, with rare off-profile tags. */
function sampleTags(persona: Persona, rng: Rng): string[] {
  const names = persona.tagMix.map((t) => t.name);
  const weights = persona.tagMix.map((t) => t.weight);
  const count = 1 + rng.weighted([0, 1, 2], [6, 3, 1]); // mostly 1, sometimes 2–3
  const out = new Set<string>();
  for (let i = 0; i < count; i++) out.add(rng.weighted(names, weights));
  // Occasional off-profile tag for realism.
  if (rng.bool(0.08)) out.add("#misc");
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
  const deadlineDay = day + horizon;
  // End-of-working-day deadline in the persona's tz.
  return clock
    .at(deadlineDay, persona.prefs.workEnd, persona.prefs.timezone)
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

const TITLE_TEMPLATES: Record<string, string[]> = {
  default: ["Work on", "Handle", "Finish", "Review", "Draft"],
};

function title(tags: string[], rng: Rng): string {
  const verb = rng.pick(TITLE_TEMPLATES.default);
  const subject = tags[0]?.replace(/^#/, "") ?? "task";
  return `${verb} ${subject}`;
}

/** Emit the day's task specs for a persona (empty on idle/zero-volume days). */
export function generateTasksForDay(
  persona: Persona,
  clock: SimClock,
  day: number,
  rng: Rng,
): TaskSpec[] {
  const count = dailyCount(persona, clock, day, rng);
  if (count === 0) return [];

  const specs: TaskSpec[] = [];
  for (let i = 0; i < count; i++) {
    const tags = sampleTags(persona, rng);
    const view = sampleView(persona, rng);
    const deadline = sampleDeadline(persona, clock, day, rng);
    const { est, trueDur } = sampleDurations(persona, tags, rng);
    // Arrival spread across the working window.
    const span = Math.max(60, persona.prefs.workEnd - persona.prefs.workStart);
    const arrivalMinute = Math.floor(
      persona.prefs.workStart + rng.next() * span,
    );

    specs.push({
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
    });
  }
  // Arrivals in chronological order within the day.
  specs.sort((a, b) => a.arrivalMinute - b.arrivalMinute);
  return specs;
}
