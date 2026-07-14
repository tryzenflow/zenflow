import type { EdfTask, Placement, SchedulerPrefs } from "../interfaces";
import {
  MS_PER_MINUTE,
  SLOT_MS,
  addDaysStr,
  ceilToSlot,
  isoWeekday,
  localDateStr,
  minutesOutsideWorkWindow,
  overlapsAny,
  workWindowFor,
  type Interval,
} from "./slot";
import {
  DEVIATION_HORIZON_DAYS,
  DEVIATION_WEIGHT_FAR,
  DEVIATION_WEIGHT_NEAR,
  HOURS_RATE,
  LATENESS_RATE,
  MAX_SCAN_DAYS,
} from "../constants";
import { minutesToUtc } from "../../common/utils";
import { cellScore, rankByScores, type RankedCandidate } from "./reranker";

/**
 * Pure, deterministic Earliest-Deadline-First scheduling core (docs/heuristic.md).
 * No I/O, no clock, no *uncontrolled* randomness — `now` is always injected,
 * and the only randomness (the softmax re-ranker's Gumbel noise) comes from a
 * seed. `SchedulerService` is the only layer that touches Prisma/telemetry;
 * everything here is a plain function of its inputs.
 *
 * Placement is now governed by a single continuous, cost-based soft-constraint
 * model ({@link placementCost}) instead of a hard `manuallyMoved` freeze plus a
 * hard deadline cutoff. For a task currently anchored at its stored
 * `scheduledStartTime` (wherever it sits right now, regardless of whether a
 * human dragged it there or the algorithm placed it), the cost of a candidate
 * slot is:
 *
 *   deviationCost(t, c) + latenessCost(t, c) + offHoursCost(c) − preferenceBonus(c)
 *
 * `deviationCost` scales with how far the candidate sits from the anchor,
 * weighted by how far in the FUTURE that anchor is (near-term anchors are
 * expensive to move; far-future ones are cheap — {@link deviationWeight}). A
 * task with no anchor (new, or currently unplaced) has zero deviation cost:
 * nothing to preserve. `latenessCost`/`offHoursCost` replace what used to be
 * hard tiers (deadline cutoff, work-hours window) with per-minute penalties,
 * so a tightened deadline or an off-hours slot is now just expensive, not
 * impossible. The ONLY hard constraints left are (1) no two tasks may ever
 * overlap, (2) a task whose placement has already started/elapsed
 * (`isPast`) is completely frozen, and (3) a task whose OWN deadline has
 * already passed (`isOverdue`) is likewise frozen — both are the floor of
 * the deviation curve, not a tunable weight.
 *
 * `feasibleSlots` (in-hours, respecting the deadline), `findSlotIgnoringWorkHours`
 * (ignores work hours, still respects the deadline) and `findNextAvailableSlot`
 * (in-hours, ignores the deadline) remain the three candidate SOURCES —
 * what used to be "Tier 1/2/3" — but they're no longer tried in strict
 * priority order with an early exit; {@link scheduleAll} pools whatever they
 * produce and picks the minimum-cost candidate, with near-ties broken by the
 * existing seeded-softmax stochastic logging policy ({@link
 * "./reranker".rankByScores}) so IPS/propensity logging keeps working.
 *
 * A task's `manuallyMoved` flag by itself grants NO protection under the cost
 * model — it's informational only (the "Manually placed" badge/telemetry),
 * and a manually-pinned task is exactly as evictable as any other anchored
 * task once its turn comes up in EDF order. What DOES exist is a separate,
 * explicit, PER-CALL pin: {@link scheduleAll}'s optional `pinnedTaskId`
 * parameter. `SchedulerService.reoptimize` sets it to the task a caller just
 * directly dragged/resized (`TasksService.displace`/`resize`), so THAT one
 * `scheduleAll` invocation treats it exactly like an `isPast` task — hard-
 * frozen at its just-written slot, seeded into occupied space before any
 * other task is placed, entirely excluded from the EDF eviction/placement
 * race. This closes the gap the pure cost model alone left open: EDF order
 * only lets a task evict a LOWER-priority (later-deadline) occupant of a
 * contested slot, so a just-dragged task without the earliest deadline among
 * contenders could lose the race for its own requested slot to a task
 * processed earlier in the loop, even though no cost comparison ever
 * favored moving it. The pin is scoped to exactly one `scheduleAll` call —
 * nothing is written to the DB about it, so the very next reoptimize (for
 * any other create/edit/drag) leaves this task fully subject to the cost
 * model again, like any other anchor.
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
 * This is a hard freeze in the cost model — the floor of the deviation curve
 * (an infinitely-expensive-to-move anchor), not a tunable weight. The only
 * other hard freeze is {@link scheduleAll}'s per-call `pinnedTaskId`, which
 * this function has no awareness of (it's applied directly in `scheduleAll`'s
 * past/rest split, not folded into `isPast` itself).
 */
export function isPast(task: EdfTask, now: Date): boolean {
  if (task.scheduledStartTime === null) return false;
  return task.scheduledStartTime.getTime() <= now.getTime();
}

/**
 * A task is "overdue" once its own deadline has already passed —
 * `deadline <= now` — regardless of whether (or where) it's currently
 * placed. Like {@link isPast}, this is a hard freeze in {@link scheduleAll}:
 * once a deadline is missed there's no "correct" slot left for the cost
 * model to route toward (lateness is unavoidable everywhere), so rather than
 * having it search for a placement anyway — which, worse, can land BEFORE
 * `now` (see `findNextAvailableSlot`'s `searchFrom` clamp in
 * {@link candidatesFor}/{@link fallbackSlot} for why an un-clamped search can
 * do that once its `deadline ?? now` floor is itself in the past) — an
 * overdue task is simply left exactly where it is, surfaced to the user to
 * act on rather than silently auto-placed. A task with no deadline is never
 * overdue.
 */
export function isOverdue(task: EdfTask, now: Date): boolean {
  return task.deadline !== null && task.deadline.getTime() <= now.getTime();
}

/** Never search earlier than `now` — a deadline that's already passed must
 * not pull a fallback search's floor into the past (see `isOverdue`'s doc
 * comment). */
function laterOf(a: Date, b: Date): Date {
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

/**
 * `findSlotIgnoringWorkHours` → `findNextAvailableSlot` fallback, tried once
 * {@link feasibleSlots} finds nothing: first a slot that ignores work hours
 * but still respects the deadline (or the same no-deadline horizon
 * {@link feasibleSlots} itself uses), then — only if that also fails — the
 * deadline is dropped too and the next in-work-hours slot is taken regardless
 * of how overdue it is. Returns null only when neither finds room within
 * {@link MAX_SCAN_DAYS} — a genuinely saturated calendar. Used directly by
 * `SchedulerService.simulate()`'s not-yet-created draft-task preview (which
 * has no anchor to weigh against, so a single best fallback candidate — not
 * the full cost-scored pool `scheduleAll` builds — is all it needs).
 */
export function fallbackSlot(
  task: EdfTask,
  now: Date,
  occupied: Interval[],
  prefs: SchedulerPrefs,
): Interval | null {
  const ceiling = task.deadline
    ? task.deadline.getTime()
    : now.getTime() + MAX_SCAN_DAYS * 24 * 60 * MS_PER_MINUTE;
  const tier2 = findSlotIgnoringWorkHours(task, now, occupied, prefs, ceiling);
  if (tier2) return tier2;
  const searchFrom = task.deadline ? laterOf(task.deadline, now) : now;
  return findNextAvailableSlot(task, searchFrom, occupied, prefs);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * How expensive it is to move a task away from its current anchor, as a
 * function of how far in the FUTURE that anchor sits: `lerp(W_NEAR, W_FAR,
 * clamp((anchor − now) / HORIZON, 0, 1))`. An anchor at (or before) `now`
 * costs {@link DEVIATION_WEIGHT_NEAR} per minute of deviation (in practice
 * such a task is already hard-frozen by `isPast` before this ever runs); an
 * anchor at/beyond {@link DEVIATION_HORIZON_DAYS} out bottoms out at
 * {@link DEVIATION_WEIGHT_FAR} — cheap to renegotiate.
 */
export function deviationWeight(anchor: Date, now: Date): number {
  const horizonMs = DEVIATION_HORIZON_DAYS * 24 * 60 * MS_PER_MINUTE;
  const t = clamp((anchor.getTime() - now.getTime()) / horizonMs, 0, 1);
  return (
    DEVIATION_WEIGHT_NEAR + (DEVIATION_WEIGHT_FAR - DEVIATION_WEIGHT_NEAR) * t
  );
}

/**
 * `deviationWeight(anchor, now) × |candidateStart − anchor|` (minutes). Zero
 * for a task with no anchor (`anchor === null` — nothing yet placed, nothing
 * to preserve) and zero, by construction, when `candidateStart === anchor`
 * (staying put never costs anything to deviate).
 */
export function deviationCost(
  anchor: Date | null,
  candidateStart: number,
  now: Date,
): number {
  if (anchor === null) return 0;
  const diffMinutes =
    Math.abs(candidateStart - anchor.getTime()) / MS_PER_MINUTE;
  return deviationWeight(anchor, now) * diffMinutes;
}

/**
 * `LATENESS_RATE × minutes the candidate ends past the deadline` (0 when the
 * task has no deadline, or the candidate ends at/before it). Replaces the old
 * hard deadline cutoff — a candidate past the deadline is now merely
 * expensive, scaled deliberately higher than {@link offHoursCost}'s per-minute
 * rate so deadline pressure still beats work-hours preference.
 */
export function latenessCost(
  candidateEnd: number,
  deadline: Date | null,
): number {
  if (!deadline) return 0;
  const lateMinutes = Math.max(
    0,
    (candidateEnd - deadline.getTime()) / MS_PER_MINUTE,
  );
  return LATENESS_RATE * lateMinutes;
}

/**
 * `HOURS_RATE × minutes of the candidate that fall outside the user's
 * work-hours window` ({@link minutesOutsideWorkWindow}). Replaces the old hard
 * work-hours tiering.
 */
export function offHoursCost(
  candidate: Interval,
  prefs: SchedulerPrefs,
): number {
  return HOURS_RATE * minutesOutsideWorkWindow(candidate, prefs);
}

/**
 * The full placement cost for `task` at candidate slot `candidate`:
 * `deviationCost + latenessCost + offHoursCost − preferenceBonus`, where the
 * preference bonus reuses the same signed-preference-matrix cell score the
 * softmax re-ranker already computes ({@link cellScore}) — a liked slot
 * literally subtracts from cost, so it can win over a slightly-cheaper but
 * disliked one. Lower is better; {@link scheduleAll} picks the minimum.
 */
export function placementCost(
  task: EdfTask,
  candidate: Interval,
  now: Date,
  prefs: SchedulerPrefs,
  matrix: readonly number[] = [],
): number {
  return (
    deviationCost(task.scheduledStartTime, candidate.start, now) +
    latenessCost(candidate.end, task.deadline) +
    offHoursCost(candidate, prefs) -
    cellScore(candidate, matrix, prefs.timezone)
  );
}

/**
 * Pool candidates from every source ({@link feasibleSlots},
 * {@link findSlotIgnoringWorkHours}, {@link findNextAvailableSlot}) — no more
 * priority tiering, every source always contributes — plus, when it doesn't
 * collide with `occupied`, the task's own current anchor (so "stay exactly
 * where you are" is always a candidate {@link placementCost} can evaluate,
 * even when none of the three generators happens to reproduce it — e.g. an
 * off-hours anchor placed on an earlier pass, which `findSlotIgnoringWorkHours`
 * would otherwise re-derive fresh from the current `now` and might not match).
 * De-duplicated by start time.
 */
function candidatesFor(
  task: EdfTask,
  now: Date,
  prefs: SchedulerPrefs,
  occupied: Interval[],
): Interval[] {
  const out: Interval[] = [];
  const seen = new Set<number>();
  const add = (iv: Interval | null | undefined) => {
    if (!iv || seen.has(iv.start)) return;
    seen.add(iv.start);
    out.push(iv);
  };

  for (const iv of feasibleSlots(task, now, prefs, occupied)) add(iv);

  const ceiling = task.deadline
    ? task.deadline.getTime()
    : now.getTime() + MAX_SCAN_DAYS * 24 * 60 * MS_PER_MINUTE;
  add(findSlotIgnoringWorkHours(task, now, occupied, prefs, ceiling));
  const searchFrom = task.deadline ? laterOf(task.deadline, now) : now;
  add(findNextAvailableSlot(task, searchFrom, occupied, prefs));

  const anchor = intervalOf(task);
  if (anchor && !overlapsAny(occupied, anchor.start, anchor.end)) add(anchor);

  return out;
}

/**
 * Absolute cost-unit tolerance for "comparably costed" in {@link rankByCost}
 * — small enough that no genuine, deliberate cost difference (deviation,
 * lateness, off-hours minutes, or a signed preference-matrix delta) could
 * ever fall inside it, large enough to swallow floating-point noise.
 */
const NEAR_TIE_EPSILON = 1e-6;

/**
 * {@link candidatesFor}, scored by `-placementCost` and ranked via the shared
 * softmax mechanism — but ONLY among candidates within {@link
 * NEAR_TIE_EPSILON} of the true minimum cost. Candidates that aren't
 * genuinely competitive (e.g. an off-hours or past-deadline fallback sitting
 * far above an in-hours candidate pool) are excluded from the ranking pool
 * entirely, not just outscored: pooling them in would let the Gumbel-noise
 * stochastic-sampling step occasionally hand the placement to one of them
 * anyway (real softmax sampling, working as intended, just not what "pick
 * the minimum, with near-ties broken by the ranker" means here) AND would
 * corrupt the deterministic earliest-first tie-break `rankByScores` uses
 * when candidates tie exactly (a same-cost tier1 pool no longer looks
 * "all equal" once a differently-costed tier2/3 fallback sits in the same
 * array). Restricting to the near-minimum band keeps genuine ties
 * deterministic while still routing genuinely-close (but unequal) costs —
 * e.g. two candidates a preference delta apart — through the stochastic
 * logging policy.
 */
function rankByCost(
  task: EdfTask,
  candidates: Interval[],
  now: Date,
  prefs: SchedulerPrefs,
  matrix: readonly number[],
): RankedCandidate[] {
  if (candidates.length === 0) return [];
  const costs = candidates.map((c) =>
    placementCost(task, c, now, prefs, matrix),
  );
  const minCost = Math.min(...costs);
  const contenders: Interval[] = [];
  const scores: number[] = [];
  for (let i = 0; i < candidates.length; i++) {
    if (costs[i] <= minCost + NEAR_TIE_EPSILON) {
      contenders.push(candidates[i]);
      scores.push(-costs[i]);
    }
  }
  return rankByScores(contenders, scores, task.id);
}

/** Stable comparator: deadline ascending (nulls last), then createdAt ascending. */
function compareMovable(a: EdfTask, b: EdfTask): number {
  const ad = a.deadline ? a.deadline.getTime() : Infinity;
  const bd = b.deadline ? b.deadline.getTime() : Infinity;
  if (ad !== bd) return ad - bd;
  return a.createdAt.getTime() - b.createdAt.getTime();
}

/**
 * Greedy EDF core, now cost-aware. `tasks` splits into a hard-FROZEN bucket
 * (seeded as occupied space up front, echoed through unchanged) and every
 * other task, processed in EDF order (deadline ascending, then createdAt). A
 * task lands in the frozen bucket for any of three independent reasons: it's
 * `isPast(task, now)` (its placement already started/elapsed), it's
 * `isOverdue(task, now)` (its own deadline already passed — see that
 * function's doc comment for why the algorithm must not try to place it
 * anyway), OR its id matches the optional `pinnedTaskId` param (a one-off,
 * PER-CALL freeze — see below). All three share the exact same "seed
 * occupiedFinal, echo the placement unchanged" handling since the
 * requirement is identical (nothing may ever move or re-evaluate them), but
 * they mean different things: `isPast`/`isOverdue` are intrinsic properties
 * of the task itself, unrelated to any particular call; `pinnedTaskId` is NOT
 * a property of the task at all — it's an instruction from THIS CALLER for
 * THIS CALL ONLY, and carries no state beyond it (the next `scheduleAll`
 * invocation, with `pinnedTaskId` unset or pointing elsewhere, is free to
 * move this task like any other anchor again).
 *
 * `pinnedTaskId` exists to close a gap the pure cost model alone leaves open:
 * EDF order only lets a task evict a LOWER-priority (later-deadline) occupant
 * of a contested slot it wants — it can never touch a task that was already
 * finalized earlier in the loop (an earlier deadline). So a task with no
 * special protection could simply lose the race for its own slot to an
 * earlier-deadline task that claims it first via ordinary placement, never
 * even going through a cost comparison. `SchedulerService.reoptimize` uses
 * `pinnedTaskId` to hard-pin the ONE task a caller just directly
 * dragged/resized (`TasksService.displace`/`resize`), so that task's just-
 * written slot is guaranteed to survive the very reoptimize call triggered
 * by that same drag/resize, regardless of EDF order — every other task's
 * candidate search naturally routes around it because it's already occupied
 * space before anything else is placed.
 *
 * The occupied baseline starts from EVERY pending (non-frozen) task's CURRENT
 * placement too — this is what keeps an already-good schedule stable beyond
 * the frozen bucket: a task about to be processed first checks whether its
 * own anchor slot is still free and cost-optimal (its {@link placementCost}
 * against the pooled candidate set, ignoring not-yet-processed tasks'
 * anchors); if so it's kept unmoved. If its best candidate collides with a
 * not-yet-processed (hence lower- or equal-priority) task's anchor, a
 * single-level bounded eviction decides whether to bump that task (only if
 * genuinely cost-favorable to do so — comparing the incoming task's cost at
 * the contested slot plus the occupant's relocation cost, against the
 * incoming task simply taking its own next-best FREE slot instead) or to
 * leave both exactly where the collision found them, deferring the occupant
 * to its own turn later in the loop. This never cascades past one level — an
 * evicted task always relocates to its own next-best genuinely-free
 * candidate (never triggering a second eviction).
 *
 * A task placeable by NONE of the candidate sources (including its own
 * eviction-relocation attempt) comes back `{ scheduledStartTime: null,
 * conflict: true }` — a rare, genuinely-saturated-calendar case.
 *
 * No more scope/window parameter: there's no window-based eligibility filter
 * left to carry (the continuous cost model IS what bounds movement now). The
 * one thing the old `CascadeScope.fixedTaskId` did — marking which task's
 * placement event is the CALLER's to log, not double-logged as collateral
 * RESCHEDULED — turned out to be purely a `SchedulerService`-layer concern
 * (see `reoptimize`'s `opts.fixedTaskId`, a DIFFERENT option from
 * `pinnedTaskId` — one is event-attribution bookkeeping, the other is a
 * placement constraint); the pure core never needed that one.
 */
export function scheduleAll(
  prefs: SchedulerPrefs,
  tasks: EdfTask[],
  now: Date,
  matrix: readonly number[] = [],
  pinnedTaskId?: string,
): Placement[] {
  const frozen: EdfTask[] = [];
  const rest: EdfTask[] = [];
  for (const task of tasks) {
    if (isPast(task, now) || isOverdue(task, now) || task.id === pinnedTaskId)
      frozen.push(task);
    else rest.push(task);
  }

  const occupiedFinal: Interval[] = [];
  const placements = new Map<string, Placement>();

  for (const task of frozen) {
    const iv = intervalOf(task);
    if (iv) occupiedFinal.push(iv);
    placements.set(task.id, {
      id: task.id,
      scheduledStartTime: task.scheduledStartTime,
      conflict: task.conflict,
      manuallyMoved: task.manuallyMoved,
    });
  }

  const byId = new Map(rest.map((t) => [t.id, t]));
  const remainingAnchors = new Map<string, Interval>();
  for (const t of rest) {
    const iv = intervalOf(t);
    if (iv) remainingAnchors.set(t.id, iv);
  }

  const resolved = new Set<string>();

  /** Finalize `task`'s placement, marking it resolved and adding it to `occupiedFinal`. */
  const place = (
    task: EdfTask,
    result: { start: Date; end: Date; propensity?: number } | null,
  ): void => {
    remainingAnchors.delete(task.id);
    resolved.add(task.id);
    if (!result) {
      placements.set(task.id, {
        id: task.id,
        scheduledStartTime: null,
        conflict: true,
        manuallyMoved: false,
      });
      return;
    }
    occupiedFinal.push({
      start: result.start.getTime(),
      end: result.end.getTime(),
    });
    const stayed =
      task.scheduledStartTime?.getTime() === result.start.getTime();
    placements.set(task.id, {
      id: task.id,
      scheduledStartTime: result.start,
      conflict: false,
      // Preserve the informational pin only when nothing actually moved;
      // once the algorithm relocates a task it's no longer at the spot the
      // pin (or a prior placement) recorded.
      manuallyMoved: stayed ? task.manuallyMoved : false,
      propensity: result.propensity,
    });
  };

  /** Best genuinely-FREE candidate for `task` (excludes `extraOccupied` too). */
  const bestFree = (
    task: EdfTask,
    extraOccupied: Interval[],
  ): RankedCandidate | undefined => {
    const candidates = candidatesFor(task, now, prefs, [
      ...occupiedFinal,
      ...extraOccupied,
    ]);
    return rankByCost(task, candidates, now, prefs, matrix)[0];
  };

  for (const task of [...rest].sort(compareMovable)) {
    if (resolved.has(task.id)) continue;
    remainingAnchors.delete(task.id);

    const softOccupied = [...remainingAnchors.values()];
    const wishCandidates = candidatesFor(task, now, prefs, occupiedFinal);
    const wishRanked = rankByCost(task, wishCandidates, now, prefs, matrix);

    if (wishRanked.length === 0) {
      place(task, null);
      continue;
    }

    const top = wishRanked[0];
    const topInterval = { start: top.start.getTime(), end: top.end.getTime() };
    const blockers = [...remainingAnchors.entries()].filter(
      ([, iv]) => iv.start < topInterval.end && topInterval.start < iv.end,
    );

    if (blockers.length === 0) {
      place(task, top);
      continue;
    }

    if (blockers.length > 1) {
      // More than one lower-priority occupant in the way is beyond the
      // single-level eviction bound — just take the task's own next-best
      // slot that's ACTUALLY free right now.
      place(task, bestFree(task, softOccupied) ?? null);
      continue;
    }

    const [blockerId] = blockers[0];
    const blocker = byId.get(blockerId)!;

    const ownNextBest = bestFree(task, softOccupied);
    const costOwnNextBest = ownNextBest
      ? placementCost(
          task,
          {
            start: ownNextBest.start.getTime(),
            end: ownNextBest.end.getTime(),
          },
          now,
          prefs,
          matrix,
        )
      : Infinity;
    const costAtContested = placementCost(
      task,
      topInterval,
      now,
      prefs,
      matrix,
    );

    const otherRemaining = [...remainingAnchors.entries()]
      .filter(([id]) => id !== blockerId)
      .map(([, iv]) => iv);
    const blockerRelocated = (() => {
      const candidates = candidatesFor(blocker, now, prefs, [
        ...occupiedFinal,
        ...otherRemaining,
        topInterval,
      ]);
      return rankByCost(blocker, candidates, now, prefs, matrix)[0];
    })();
    const costBlockerRelocated = blockerRelocated
      ? placementCost(
          blocker,
          {
            start: blockerRelocated.start.getTime(),
            end: blockerRelocated.end.getTime(),
          },
          now,
          prefs,
          matrix,
        )
      : Infinity;

    const evictionCost = costAtContested + costBlockerRelocated;

    // Ties favor eviction ("if evicting is cheaper [or equal], evict") — the
    // task currently being placed is the higher-EDF-priority one (or, at a
    // service layer, the one the user just directly acted on via a drag), so
    // an exact-cost tie should resolve in ITS favor rather than silently
    // redirecting it elsewhere. EXCEPT when eviction wouldn't actually help
    // (the blocker has nowhere to go either, `evictionCost` is Infinity) —
    // then there's nothing to gain by bumping it, so fall through to the
    // task's own next-best (even if that's also a dead end) rather than
    // evicting a task that just becomes unplaceable in its place.
    if (!Number.isFinite(evictionCost) || costOwnNextBest < evictionCost) {
      place(task, ownNextBest ?? null);
    } else {
      place(task, top);
      place(blocker, blockerRelocated ?? null);
    }
  }

  return tasks.map((t) => placements.get(t.id)!);
}
