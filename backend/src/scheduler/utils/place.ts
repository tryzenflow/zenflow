import type { EdfTask, SchedulerPrefs } from "../interfaces";
import {
  MS_PER_MINUTE,
  SLOT_MS,
  addDaysStr,
  ceilToSlot,
  isoWeekday,
  localDateStr,
  overlapsAny,
  workWindowFor,
  type Interval,
} from "./slot";
import { MAX_SCAN_DAYS } from "../constants";
import { minutesToUtc } from "../../common/utils";
import { pickBest } from "./reranker";

/**
 * Pure, deterministic single-task placer (docs/heuristic.md, CLAUDE.md
 * invariant #2). No I/O, no clock, no *uncontrolled* randomness — `now` is
 * always injected, and the only randomness (the softmax re-ranker's Gumbel
 * noise, via {@link "./reranker".pickBest}) comes from a seed derived from the
 * task's own id. `SchedulerService` is the only layer that touches
 * Prisma/telemetry; everything here is a plain function of its inputs.
 *
 * This replaces the old whole-backlog cost-model solver (`scheduleAll` et
 * al., since deleted) with a narrow TIERED placer, {@link placeTask}, that
 * decides ONE task's own slot and never compares against, evicts, or moves
 * any other task. It is used by every automatic placement path — Create
 * (`SchedulerService.placeNewTask`) and Edit-accept
 * (`SchedulerService.resolveInvalidPlacement`) — and nowhere else; Drag/
 * Resize write the user's requested interval directly
 * (`SchedulerService.applyDirectPlacement`), and the one place allowed to
 * touch more than one task at a time is the explicit, opt-in Optimize action
 * (`optimize.ts`).
 *
 * `placeTask` tries three candidate sources in strict priority order, each a
 * hard tier (no blending, no cost comparison between them):
 *
 * 1. **Tier 1** — {@link feasibleSlots}: in-hours, before the deadline. When
 *    non-empty, the softmax/Gumbel re-ranker ({@link "./reranker".pickBest})
 *    picks among them by the user's signed preference matrix, degenerating
 *    to earliest-first with uniform propensity on cold start (an empty/
 *    all-zero/wrong-length matrix) — exactly as before.
 * 2. **Tier 2** — {@link findSlotIgnoringWorkHours}: outside work hours, still
 *    before the deadline. Deterministic earliest (no re-ranking — there's no
 *    preference signal for outside-hours slots).
 * 3. **Tier 3** — {@link findNextAvailableSlot}: in-hours, deadline dropped
 *    entirely (the "deadline actually missed" case). Deterministic earliest.
 *
 * A task placeable by none of the three tiers comes back `{ interval: null,
 * tier: "unplaced" }` — a rare, genuinely-saturated-calendar case.
 */

/** Map a placed task to its occupied {@link Interval}; null when unplaced. */
export function intervalOf(task: {
  scheduledStartTime: Date | null;
  durationMinutes: number;
}): Interval | null {
  if (task.scheduledStartTime === null) return null;
  const start = task.scheduledStartTime.getTime();
  return { start, end: start + task.durationMinutes * MS_PER_MINUTE };
}

/**
 * A task is "past" (frozen, no longer placeable by the tiered search) once
 * its placement has already started — whether it's currently in progress or
 * has fully elapsed, both satisfy `scheduledStartTime <= now`. Unplaced tasks
 * are never past. Callers (`SchedulerService`) are responsible for never
 * invoking {@link placeTask} on a task this is true for — the pure core
 * itself doesn't guard against it.
 */
export function isPast(task: EdfTask, now: Date): boolean {
  if (task.scheduledStartTime === null) return false;
  return task.scheduledStartTime.getTime() <= now.getTime();
}

/**
 * A task is "overdue" once its own deadline has already passed —
 * `deadline <= now` — regardless of whether (or where) it's currently
 * placed. Like {@link isPast}, callers are responsible for deciding whether
 * an overdue task should even be offered a fresh search (today, no automatic
 * path calls {@link placeTask} for one — Edit's offer-to-reschedule only
 * fires for a task still in the future).
 */
export function isOverdue(task: EdfTask, now: Date): boolean {
  return task.deadline !== null && task.deadline.getTime() <= now.getTime();
}

/** Never search earlier than `now` — a deadline that's already passed must
 * not pull a fallback search's floor into the past (see `isOverdue`'s doc
 * comment). */
export function laterOf(a: Date, b: Date): Date {
  return a.getTime() > b.getTime() ? a : b;
}

/**
 * Every 15-min-grid-aligned feasible start for `task` between
 * `max(now, earliestStart ?? now)` and `task.deadline` (or `now +
 * MAX_SCAN_DAYS` days when there's no deadline), that fits inside a work day's
 * window (cross-midnight-aware via {@link workWindowFor}) and doesn't overlap
 * `occupied`. Returned in chronological order (earliest first).
 */
export function feasibleSlots(
  task: EdfTask,
  now: Date,
  prefs: SchedulerPrefs,
  occupied: Interval[],
  earliestStart?: Date,
): Interval[] {
  const durationMs = task.durationMinutes * MS_PER_MINUTE;
  const floor = Math.max(now.getTime(), (earliestStart ?? now).getTime());
  const ceiling = task.deadline
    ? task.deadline.getTime()
    : now.getTime() + MAX_SCAN_DAYS * 24 * 60 * MS_PER_MINUTE;

  if (ceiling - floor < durationMs) return [];

  const results: Interval[] = [];
  const ceilingDateStr = localDateStr(new Date(ceiling), prefs.timezone);
  let dateStr = localDateStr(new Date(floor), prefs.timezone);

  // Hard iteration guard: normally bounded by the day-distance between floor
  // and ceiling, but a misconfigured far-future deadline should never hang.
  for (let i = 0; i < 1000 && dateStr <= ceilingDateStr; i++) {
    if (prefs.workDays.includes(isoWeekday(dateStr))) {
      const win = workWindowFor(
        dateStr,
        prefs.workStart,
        prefs.workEnd,
        prefs.timezone,
      );
      const winStart = Math.max(win.start, floor);
      const winEnd = Math.min(win.end, ceiling);
      for (
        let start = ceilToSlot(winStart);
        start + durationMs <= winEnd;
        start += SLOT_MS
      ) {
        const end = start + durationMs;
        if (!overlapsAny(occupied, start, end)) {
          results.push({ start, end });
        }
      }
    }
    dateStr = addDaysStr(dateStr, 1);
  }

  return results;
}

/**
 * A candidate source that ignores the work-hours window entirely (still
 * respecting `occupied`), scanning forward from `now` on the 15-min grid.
 * Among the feasible gaps found on a given day, prefers the one CLOSEST to
 * that day's working-hours region (measured to the window's start/end; a gap
 * that overlaps the window itself has distance 0) rather than an arbitrary
 * midnight-adjacent gap. Advances day-by-day (up to {@link MAX_SCAN_DAYS}) if a
 * day has no feasible gap at all; returns null once every day in that horizon
 * is fully booked.
 *
 * `ceiling` (epoch ms, optional) bounds the search by a hard deadline — once
 * the search floor reaches it, scanning stops (never returns a slot past it),
 * and each day's own scan window is clipped to it too (not just that day's
 * midnight). Omitted entirely, this scans unbounded (`MAX_SCAN_DAYS` is still
 * the hard iteration guard) — used anywhere a deadline genuinely doesn't apply.
 */
export function findSlotIgnoringWorkHours(
  task: EdfTask,
  now: Date,
  occupied: Interval[],
  prefs: SchedulerPrefs,
  ceiling?: number,
): Interval | null {
  const durationMs = task.durationMinutes * MS_PER_MINUTE;
  let floor = ceilToSlot(now.getTime());

  for (let i = 0; i < MAX_SCAN_DAYS; i++) {
    if (ceiling !== undefined && floor >= ceiling) return null;

    const dateStr = localDateStr(new Date(floor), prefs.timezone);
    const dayStart = minutesToUtc(dateStr, 0, prefs.timezone).getTime();
    const dayEndRaw = minutesToUtc(
      addDaysStr(dateStr, 1),
      0,
      prefs.timezone,
    ).getTime();
    const dayEnd =
      ceiling !== undefined ? Math.min(dayEndRaw, ceiling) : dayEndRaw;
    const regionStart = Math.max(dayStart, floor);
    const win = workWindowFor(
      dateStr,
      prefs.workStart,
      prefs.workEnd,
      prefs.timezone,
    );

    let best: Interval | null = null;
    let bestDistance = Infinity;

    for (
      let s = ceilToSlot(regionStart);
      s + durationMs <= dayEnd;
      s += SLOT_MS
    ) {
      const e = s + durationMs;
      if (overlapsAny(occupied, s, e)) continue;
      let distance: number;
      if (e <= win.start) distance = win.start - e;
      else if (s >= win.end) distance = s - win.end;
      else distance = 0; // overlaps the work window itself — as close as possible
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { start: s, end: e };
      }
    }

    if (best) return best;
    floor = dayEndRaw; // this day is fully booked — advance
  }

  return null;
}

/**
 * A candidate source that ignores `task.deadline` entirely (the deadline may
 * already be overdue) and returns the earliest in-WORK-HOURS slot at/after
 * `searchFrom`. Scans day-by-day up to {@link MAX_SCAN_DAYS}; returns null if
 * none is found in that horizon.
 */
export function findNextAvailableSlot(
  task: EdfTask,
  searchFrom: Date,
  occupied: Interval[],
  prefs: SchedulerPrefs,
): Interval | null {
  const durationMs = task.durationMinutes * MS_PER_MINUTE;
  const floor = ceilToSlot(searchFrom.getTime());
  let dateStr = localDateStr(new Date(floor), prefs.timezone);

  for (let i = 0; i < MAX_SCAN_DAYS; i++) {
    if (prefs.workDays.includes(isoWeekday(dateStr))) {
      const win = workWindowFor(
        dateStr,
        prefs.workStart,
        prefs.workEnd,
        prefs.timezone,
      );
      const winStart = Math.max(win.start, floor);
      for (
        let s = ceilToSlot(winStart);
        s + durationMs <= win.end;
        s += SLOT_MS
      ) {
        const e = s + durationMs;
        if (!overlapsAny(occupied, s, e)) return { start: s, end: e };
      }
    }
    dateStr = addDaysStr(dateStr, 1);
  }

  return null;
}

/** Which candidate source ultimately placed a task — drives
 * `rationale.ts`'s `buildTierRationale` phrasing. */
export type PlacementTier =
  | "tier1-preference"
  | "tier1-earliest"
  | "tier2"
  | "tier3"
  | "unplaced";

export interface PlaceTaskResult {
  interval: Interval | null;
  tier: PlacementTier;
  /** The softmax first-choice propensity for `interval` — present only for a Tier-1 pick. */
  propensity?: number;
}

/**
 * Place ONE task, trying Tier 1 → Tier 2 → Tier 3 in strict priority order
 * (see this module's doc comment). No blending, no cost comparison, no
 * awareness of any other task beyond what's already in `occupied` — this is
 * the single-task placement primitive every automatic path (Create,
 * Edit-accept) calls; nothing here ever decides to move or evict a DIFFERENT
 * task.
 *
 * Determinism ("no churn"): calling this twice with identical inputs always
 * returns the identical slot — `now`/`occupied`/`matrix` are the only inputs,
 * and the re-ranker's Gumbel draw is seeded from `task.id` alone.
 */
export function placeTask(
  task: EdfTask,
  now: Date,
  prefs: SchedulerPrefs,
  occupied: Interval[],
  matrix: readonly number[] = [],
): PlaceTaskResult {
  const tier1 = feasibleSlots(task, now, prefs, occupied);
  if (tier1.length > 0) {
    const chosen = pickBest(tier1, matrix, prefs.timezone, task.id)!;
    const earliest = tier1[0];
    const usedPreference = chosen.start.getTime() !== earliest.start;
    return {
      interval: { start: chosen.start.getTime(), end: chosen.end.getTime() },
      tier: usedPreference ? "tier1-preference" : "tier1-earliest",
      propensity: chosen.propensity,
    };
  }

  const ceiling = task.deadline
    ? task.deadline.getTime()
    : now.getTime() + MAX_SCAN_DAYS * 24 * 60 * MS_PER_MINUTE;
  const tier2 = findSlotIgnoringWorkHours(task, now, occupied, prefs, ceiling);
  if (tier2) return { interval: tier2, tier: "tier2" };

  const searchFrom = task.deadline ? laterOf(task.deadline, now) : now;
  const tier3 = findNextAvailableSlot(task, searchFrom, occupied, prefs);
  if (tier3) return { interval: tier3, tier: "tier3" };

  return { interval: null, tier: "unplaced" };
}
