import type { EdfTask, SchedulerPrefs } from "../interfaces";
import { MS_PER_MINUTE, type Interval } from "./slot";
import { MAX_SCAN_DAYS } from "../constants";
import {
  feasibleSlots,
  findNextAvailableSlot,
  findSlotIgnoringWorkHours,
  intervalOf,
  laterOf,
  placeTask,
  type PlacementTier,
  type PlaceTaskResult,
} from "./place";
import { cellScore, rankByScores } from "./reranker";

/**
 * The ONE place in the codebase allowed to touch more than one task at a
 * time — because Optimize is the ONE explicit, opt-in, previewable-by-count
 * multi-task action (CLAUDE.md invariant #2's redesign). Everything else
 * (Create, Edit-accept, Drag, Resize, Delete, Complete) is a narrow
 * single-task operation via `place.ts`'s `placeTask` or a direct write.
 *
 * `optimize.ts` never compares one task's placement cost against another's,
 * never evicts anything, and never lets a task's OWN candidate score be
 * influenced by what a DIFFERENT task would cost to move — `repackWindow`
 * processes tasks one at a time, in EDF order, against an occupied set that
 * simply accumulates as each task claims its slot. The one exception —
 * Mode 3 ("balanced")'s proximity bias — only ever re-scores a task's OWN
 * near-tied Tier-1 candidates against that SAME task's own current slot; see
 * `repackWindow`'s doc comment.
 */

export type OptimizeMode = "full" | "retainManual" | "balanced";

export interface CandidateSplit {
  /** Tasks `repackWindow` is free to reposition. */
  movable: EdfTask[];
  /** Tasks locked at their current slot for this repack (never repositioned, only occupy space). */
  fixed: EdfTask[];
}

/**
 * Split a window's tasks into `movable`/`fixed` per `mode`:
 *  - `"full"` — every task is movable, nothing is fixed.
 *  - `"retainManual"` — tasks the user manually moved (`manuallyMoved`) are
 *    LOCKED at their current slot regardless of validity (even if currently
 *    conflicting) — everything else is movable and reflows around them.
 *  - `"balanced"` — every task is movable, same as `"full"`; the two modes
 *    differ only in HOW `repackWindow` scores a movable task's own
 *    candidates, never in which tasks are considered.
 */
export function selectCandidates(
  tasksInWindow: EdfTask[],
  mode: OptimizeMode,
): CandidateSplit {
  if (mode === "retainManual") {
    return {
      movable: tasksInWindow.filter((t) => !t.manuallyMoved),
      fixed: tasksInWindow.filter((t) => t.manuallyMoved),
    };
  }
  return { movable: tasksInWindow, fixed: [] };
}

/** Stable EDF order: deadline ascending (nulls last), then createdAt ascending. */
function compareEdf(a: EdfTask, b: EdfTask): number {
  const ad = a.deadline ? a.deadline.getTime() : Infinity;
  const bd = b.deadline ? b.deadline.getTime() : Infinity;
  if (ad !== bd) return ad - bd;
  return a.createdAt.getTime() - b.createdAt.getTime();
}

/**
 * Mode-3 ("balanced") near-term-resists-moving bias — the one place the old
 * whole-backlog cost model's `deviationWeight`/`deviationCost` shape is
 * deliberately reintroduced, but STRICTLY scoped to biasing one task's OWN
 * near-tied Tier-1 candidates against that SAME task's own current slot.
 * File-local, unexported — never touches `place.ts`, never compares against
 * another task's cost, never decides an eviction.
 */
const MODE3_HORIZON_DAYS = 7;
const MODE3_WEIGHT_NEAR = 1.0;
const MODE3_WEIGHT_FAR = 0.1;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function proximityWeight(anchor: Date, now: Date): number {
  const horizonMs = MODE3_HORIZON_DAYS * 24 * 60 * MS_PER_MINUTE;
  const t = clamp((anchor.getTime() - now.getTime()) / horizonMs, 0, 1);
  return MODE3_WEIGHT_NEAR + (MODE3_WEIGHT_FAR - MODE3_WEIGHT_NEAR) * t;
}

/**
 * `proximityWeight(anchor, now) × |candidateStart − anchor|` (minutes) — zero
 * for a task with no anchor (nothing of its own to stay close to) and zero,
 * by construction, when `candidateStart === anchor` (staying put never costs
 * anything).
 */
function proximityPenalty(
  anchor: Date | null,
  candidateStart: number,
  now: Date,
): number {
  if (anchor === null) return 0;
  const diffMinutes =
    Math.abs(candidateStart - anchor.getTime()) / MS_PER_MINUTE;
  return proximityWeight(anchor, now) * diffMinutes;
}

/**
 * Place one MOVABLE task within `repackWindow`'s loop. For `"full"`/
 * `"retainManual"` this is byte-identical to `place.ts`'s `placeTask` — no
 * scoring difference at all. For `"balanced"` ONLY, Tier 1's candidate score
 * gets one extra additive term (`-proximityPenalty`) biasing toward this
 * task's OWN current slot, scaled down the further out that slot already is
 * — still the exact same `feasibleSlots` candidate pool and the exact same
 * `rankByScores` softmax/Gumbel mechanism `placeTask` uses, just with a
 * different score function. Tier 2/3 (deterministic, no preference signal)
 * are identical across all three modes — there's no "own candidate" pool
 * there to bias.
 */
function placeMovable(
  task: EdfTask,
  now: Date,
  prefs: SchedulerPrefs,
  occupied: Interval[],
  matrix: readonly number[],
  mode: OptimizeMode,
): PlaceTaskResult {
  if (mode !== "balanced") return placeTask(task, now, prefs, occupied, matrix);

  const tier1 = feasibleSlots(task, now, prefs, occupied);
  if (tier1.length > 0) {
    const scores = tier1.map(
      (c) =>
        cellScore(c, matrix, prefs.timezone) -
        proximityPenalty(task.scheduledStartTime, c.start, now),
    );
    const ranked = rankByScores(tier1, scores, task.id);
    const chosen = ranked[0];
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

export interface RepackedPlacement {
  id: string;
  interval: Interval | null;
  tier: PlacementTier;
  propensity?: number;
}

/**
 * Process `candidates.movable` in EDF order (deadline ascending, no-deadline
 * last, then createdAt ascending) against an occupied set seeded from
 * `fixedOccupied` (everything OUTSIDE the window — the caller's job to
 * gather) plus `candidates.fixed`'s own current slots. Each task is placed
 * fresh via `placeMovable` (== `placeTask` for `"full"`/`"retainManual"`,
 * the Mode-3-biased variant for `"balanced"`); once placed, its interval is
 * added to the occupied set before the next task is processed — so later
 * (lower-EDF-priority) tasks naturally route around earlier ones, but NO
 * task's placement is ever chosen by comparing against what another task
 * would cost to move, and nothing already placed is ever revisited/evicted.
 */
export function repackWindow(
  candidates: CandidateSplit,
  fixedOccupied: Interval[],
  now: Date,
  prefs: SchedulerPrefs,
  matrix: readonly number[],
  mode: OptimizeMode,
): RepackedPlacement[] {
  const occupied: Interval[] = [...fixedOccupied];
  for (const f of candidates.fixed) {
    const iv = intervalOf(f);
    if (iv) occupied.push(iv);
  }

  const results: RepackedPlacement[] = [];
  const ordered = [...candidates.movable].sort(compareEdf);
  for (const task of ordered) {
    const placed = placeMovable(task, now, prefs, occupied, matrix, mode);
    if (placed.interval) occupied.push(placed.interval);
    results.push({ id: task.id, ...placed });
  }
  return results;
}
