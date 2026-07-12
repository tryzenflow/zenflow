import type {
  CascadeScope,
  EdfTask,
  Placement,
  SchedulerPrefs,
} from "../interfaces";
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
import { rankCandidates } from "./reranker";

/**
 * Pure, deterministic Earliest-Deadline-First scheduling core (Phase 1,
 * docs/heuristic.md). No I/O, no clock, no randomness — `now` is always
 * injected. `SchedulerService` is the only layer that touches Prisma/
 * telemetry; everything here is a plain function of its inputs.
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
 * A task is "past" (frozen, no longer reorderable) once its placement has
 * already started — whether it's currently in progress or has fully elapsed,
 * both satisfy `scheduledStartTime <= now`. Unplaced tasks are never past.
 */
export function isPast(task: EdfTask, now: Date): boolean {
  if (task.scheduledStartTime === null) return false;
  return task.scheduledStartTime.getTime() <= now.getTime();
}

/**
 * Every 15-min-grid-aligned feasible start for `task` between
 * `max(now, earliestStart ?? now)` and `task.deadline` (or `now +
 * MAX_SCAN_DAYS` days when there's no deadline), that fits inside a work day's
 * window (cross-midnight-aware via {@link workWindowFor}) and doesn't overlap
 * `occupied`. Returned in chronological order (earliest first) — callers that
 * just need the first feasible slot (`scheduleAll`) can take `[0]`; callers
 * that need the whole feasible set for re-ranking (`reranker.ts`) get every
 * candidate.
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

/** Stable comparator: deadline ascending (nulls last), then createdAt ascending. */
function compareMovable(a: EdfTask, b: EdfTask): number {
  const ad = a.deadline ? a.deadline.getTime() : Infinity;
  const bd = b.deadline ? b.deadline.getTime() : Infinity;
  if (ad !== bd) return ad - bd;
  return a.createdAt.getTime() - b.createdAt.getTime();
}

/** True when a placed task's start falls inside `[windowStart, windowEnd)`. */
function isInsideWindow(
  task: EdfTask,
  windowStart: Date,
  windowEnd: Date,
): boolean {
  if (task.scheduledStartTime === null) return true; // nothing to be "outside" of
  const t = task.scheduledStartTime.getTime();
  return t >= windowStart.getTime() && t < windowEnd.getTime();
}

/**
 * Greedy EDF core: partitions `tasks` into FROZEN (manually-moved, already
 * past/in-progress, or — when `scope` is given — currently placed outside
 * `[scope.windowStart, scope.windowEnd)` and not `scope.includeTaskId`) and
 * MOVABLE (everything else). Frozen tasks seed the occupied set and are
 * returned unchanged; movable tasks are sorted by deadline (then createdAt)
 * and greedily dropped into a {@link feasibleSlots} candidate against the
 * accumulating occupied set — the hard deadline/feasible-set computation is
 * untouched, but WHICH feasible candidate is chosen is delegated to
 * {@link rankCandidates}, the Phase-2 softmax preference re-ranker (docs/
 * heuristic.md §Phase 2): it only reorders within the feasible set (cold
 * start — an empty/wrong-length/all-zero `matrix` — falls back to the
 * original earliest-first order with uniform propensity), and its top choice
 * is taken. Each placed movable task's `propensity` is populated from that
 * choice. A movable task with no feasible slot comes back
 * `{ scheduledStartTime: null, conflict: true }` (no `propensity`).
 */
export function scheduleAll(
  prefs: SchedulerPrefs,
  tasks: EdfTask[],
  scope: CascadeScope,
  matrix: readonly number[] = [],
): Placement[] {
  const frozen: EdfTask[] = [];
  const movable: EdfTask[] = [];

  for (const task of tasks) {
    const isFixed = task.id === scope.fixedTaskId;
    const outOfScope =
      !isFixed && !isInsideWindow(task, scope.windowStart, scope.windowEnd);
    const frozenManual = task.manuallyMoved && !scope.includeManual && !isFixed;

    if (frozenManual || isPast(task, scope.windowStart) || outOfScope) {
      frozen.push(task);
    } else {
      movable.push(task);
    }
  }

  const occupied: Interval[] = [];
  const placements: Placement[] = [];

  for (const task of frozen) {
    const iv = intervalOf(task);
    if (iv) occupied.push(iv);
    placements.push({
      id: task.id,
      scheduledStartTime: task.scheduledStartTime,
      conflict: task.conflict,
      manuallyMoved: task.manuallyMoved,
    });
  }

  movable.sort(compareMovable);

  for (const task of movable) {
    const candidates = feasibleSlots(task, scope.windowStart, prefs, occupied);
    if (candidates.length === 0) {
      placements.push({
        id: task.id,
        scheduledStartTime: null,
        conflict: true,
        manuallyMoved: false,
      });
      continue;
    }
    const ranked = rankCandidates(candidates, matrix, prefs.timezone, task.id);
    const chosen = ranked[0];
    occupied.push({ start: chosen.start.getTime(), end: chosen.end.getTime() });
    placements.push({
      id: task.id,
      scheduledStartTime: chosen.start,
      conflict: false,
      manuallyMoved: false,
      propensity: chosen.propensity,
    });
  }

  return placements;
}
