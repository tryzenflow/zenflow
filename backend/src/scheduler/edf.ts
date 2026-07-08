import { MAX_SCAN_DAYS, MIN } from "./constants";
import {
  EdfTask,
  SchedulerPrefs,
  Placement,
  ScheduleScope,
} from "./interfaces";
import { identityReRanker, SlotReRanker } from "./reranker";

// Re-export the scheduler's public types so consumers can import them from "./edf".
export type { EdfTask, SchedulerPrefs, ScheduleScope };
import {
  Interval,
  SLOT_MS,
  addDaysStr,
  ceilToSlot,
  isoWeekday,
  localDateStr,
  overlapsAny,
  workWindowFor,
} from "./slot";
export function durationMs(durationMinutes: number): number {
  return durationMinutes * MIN;
}

export function intervalOf(t: {
  scheduledStartTime: Date | null;
  durationMinutes: number;
}): Interval | null {
  if (!t.scheduledStartTime) return null;
  const start = t.scheduledStartTime.getTime();
  return { start, end: start + durationMs(t.durationMinutes) };
}

/**
 * A task is "past" (frozen) iff it has a `scheduledStartTime` that already
 * begins before `now`. Past tasks are never moved, re-placed, or re-flagged for
 * conflict by any scheduling path — they keep their stored `scheduledStartTime`
 * and `conflict` verdict. A task with no `scheduledStartTime` is never past. An
 * in-progress task that started before `now` (but ends after) IS past and is
 * left alone here.
 *
 * Frozen is NOT the same as "blocks nothing": whether a placed block still
 * occupies future time — and so must block placements / can cause other live
 * tasks to conflict — is decided by {@link hasElapsed}, not by `isPast`. An
 * in-progress frozen task still occupies future time.
 */
export function isPast(
  t: { scheduledStartTime: Date | null },
  now: Date,
): boolean {
  return (
    t.scheduledStartTime !== null &&
    t.scheduledStartTime.getTime() < now.getTime()
  );
}

/**
 * A placed task has "fully elapsed" iff its whole interval ends at/before `now`
 * (`start + duration <= now`). Only a fully-elapsed block can never legitimately
 * block a future slot — it occupies no future time. This is distinct from
 * {@link isPast} (frozen / don't-move), which is true the moment a task STARTS:
 * an in-progress task (`start < now < end`) is past/frozen but NOT elapsed, so
 * it still occupies future time and must block placements and surface conflicts.
 * A task with no `scheduledStartTime` has not elapsed.
 */
export function hasElapsed(
  t: { scheduledStartTime: Date | null; durationMinutes: number },
  now: Date,
): boolean {
  const iv = intervalOf(t);
  return iv !== null && iv.end <= now.getTime();
}

/**
 * EDF ordering: deadline ascending (nulls last, i.e. +Infinity), then
 * `createdAt` ascending.
 */
export function compareEdf(a: EdfTask, b: EdfTask): number {
  const ad = a.deadline?.getTime() ?? Infinity;
  const bd = b.deadline?.getTime() ?? Infinity;
  if (ad !== bd) return ad - bd;
  return a.createdAt.getTime() - b.createdAt.getTime();
}

/**
 * ALL feasible contiguous work-hours start instants for a `durationMinutes`
 * task, in ascending order: every 15-minute-grid slot that starts at/after
 * `earliest` (and `now`), lies inside the working window of a working day, ends
 * before `deadline`, and does not overlap any `occupied` interval.
 *
 * This is the re-ranker seam the heuristic roadmap is built on: a re-ranker
 * scores this enumerated set and picks its preferred candidate, while the EDF
 * packer takes the first. The deadline acts as a hard cutoff — when a candidate
 * would END after the deadline the scan stops and the slots collected so far are
 * returned (mirroring {@link findSlot}'s early `return null`, which terminated
 * on the very first such candidate). The pure-core contract is unchanged: `now`
 * is an explicit input and there is no I/O or randomness.
 */
export function feasibleSlots(
  prefs: SchedulerPrefs,
  durationMinutes: number,
  deadline: Date | null,
  occupied: Interval[],
  now: Date,
  earliest?: Date,
): Date[] {
  const tz = prefs.timezone;
  const durMs = durationMs(durationMinutes);
  const lowerMs = Math.max(now.getTime(), earliest ? earliest.getTime() : 0);
  const fromStr = localDateStr(new Date(lowerMs), tz);
  const deadlineMs = deadline ? deadline.getTime() : null;
  const deadlineDateStr = deadline ? localDateStr(deadline, tz) : null;

  const out: Date[] = [];
  // A window that wraps past midnight and started on the *previous* day spills
  // into `now`'s morning, so when it wraps the scan begins one day earlier. The
  // `cand` clamp below keeps every candidate ≥ now/earliest, so the prev-day
  // evening slots that precede `now` are naturally skipped.
  const wraps = prefs.workEnd <= prefs.workStart;
  for (let d = wraps ? -1 : 0; d <= MAX_SCAN_DAYS; d++) {
    const dateStr = addDaysStr(fromStr, d);
    if (deadlineDateStr && dateStr > deadlineDateStr) break;
    if (!prefs.workDays.includes(isoWeekday(dateStr))) continue;

    const win = workWindowFor(dateStr, prefs.workStart, prefs.workEnd, tz);
    let cand = ceilToSlot(Math.max(win.start, lowerMs));
    for (; cand + durMs <= win.end; cand += SLOT_MS) {
      const candEnd = cand + durMs;
      // Deadline is a hard ceiling: the first candidate that overshoots it ends
      // the whole scan — no later slot can fit before the deadline either.
      if (deadlineMs !== null && candEnd > deadlineMs) return out;
      if (!overlapsAny(occupied, cand, candEnd)) out.push(new Date(cand));
    }
  }
  return out;
}

/**
 * Earliest contiguous work-hours slot of `durationMinutes` that starts at/after
 * `earliest` (and `now`) and ends before `deadline`. Returns null on conflict.
 * The first element of the full {@link feasibleSlots} enumeration.
 */
export function findSlot(
  prefs: SchedulerPrefs,
  durationMinutes: number,
  deadline: Date | null,
  occupied: Interval[],
  now: Date,
  earliest?: Date,
): Date | null {
  return (
    feasibleSlots(
      prefs,
      durationMinutes,
      deadline,
      occupied,
      now,
      earliest,
    )[0] ?? null
  );
}

/**
 * An anchored task keeps its stored slot through {@link scheduleAll}: a
 * flexible task the user manually dragged/resized (`manuallyMoved`), or —
 * when a {@link ScheduleScope} is supplied — any task outside the scope's
 * blast radius. Anchors are passed through as occupied space; only the
 * remaining movable, non-past tasks get EDF-packed.
 *
 * Scoping rule (view-scoped cascade, see `ScheduleScope`): with no scope,
 * everything non-`manuallyMoved` is movable (today's global behavior). With a
 * scope, a task is movable iff it is `scope.includeTaskId` (always, regardless
 * of its placement), OR it has a placement that falls inside
 * `[viewStart, viewEnd)`. An unplaced task that isn't `includeTaskId` is
 * frozen — it contributes no occupied interval either way, so freezing it
 * just means the cascade doesn't attempt to re-place it.
 */
function isAnchored(t: EdfTask, scope?: ScheduleScope): boolean {
  if (t.manuallyMoved && t.scheduledStartTime !== null) return true;
  if (!scope) return false;
  if (t.id === scope.includeTaskId) return false;
  if (t.scheduledStartTime === null) return true;
  const start = t.scheduledStartTime.getTime();
  const within =
    start >= scope.viewStart.getTime() && start < scope.viewEnd.getTime();
  return !within;
}

/**
 * Full deterministic re-schedule of all PENDING tasks. Manually-moved tasks
 * (and, with a `scope`, anything outside its view range) keep their anchored
 * slot. The remaining movable tasks are EDF-packed from `now` around
 * everything already occupied — closer deadlines win earlier slots, later
 * ones cascade. Used on preference changes and on the create /
 * deadline-edit-confirm / complete / delete cascade.
 */
export function scheduleAll(
  prefs: SchedulerPrefs,
  tasks: EdfTask[],
  now: Date,
  reRanker: SlotReRanker = identityReRanker,
  scope?: ScheduleScope,
): Placement[] {
  // Past tasks are frozen: never moved, never re-flagged, and excluded from the
  // occupied set so they can't block or displace future placements.
  const past = tasks.filter((t) => isPast(t, now));
  const live = tasks.filter((t) => !isPast(t, now));

  // Anchors (manually-moved, and anything the scope excludes) vs the movable
  // EDF-packed set.
  const anchored = live.filter((t) => isAnchored(t, scope));
  const plain = live.filter((t) => !isAnchored(t, scope)).sort(compareEdf);

  // Occupied space the EDF packer must avoid: every anchored live task, plus any
  // frozen past task that still occupies future time (an in-progress task,
  // `start < now < end`). Fully-elapsed past tasks (`end <= now`) occupy no
  // future time and are excluded so they never block a future slot.
  const occupied: Interval[] = [
    ...anchored,
    ...past.filter((t) => !hasElapsed(t, now)),
  ]
    .map(intervalOf)
    .filter((i): i is Interval => i !== null);

  // Frozen past tasks pass through with their stored placement + conflict.
  const out: Placement[] = past.map((t) => ({
    id: t.id,
    scheduledStartTime: t.scheduledStartTime,
    conflict: t.conflict,
  }));

  // Anchors pass through with their stored slot. For a PLACED anchor the
  // conflict verdict is NOT decided here — a manually-moved task's dragged
  // slot (and an out-of-scope frozen task's stored slot) is allowed to overlap
  // something, and that overlap must surface via the real pairwise check
  // below, after the movable tasks are packed (an anchor-vs-anchor or
  // anchor-vs-movable overlap is flagged on both sides). An UNPLACED anchor
  // (a frozen out-of-scope conflict, `scheduledStartTime: null`) has no
  // interval to re-check — the overlap pass skips null placements — so its
  // stored `conflict` verdict is carried through UNCHANGED rather than reset:
  // otherwise a frozen conflicted task would silently read back as resolved.
  out.push(
    ...anchored.map((t) => ({
      id: t.id,
      scheduledStartTime: t.scheduledStartTime,
      conflict: t.scheduledStartTime === null ? t.conflict : false,
    })),
  );

  // Movable tasks fill the gaps with EDF packing, floored at `now` (no more
  // per-task creation-day anchor/period-ceiling — see docs/heuristic.md and
  // the scheduler README) and ceilinged at the user `deadline`, if any (null =
  // unbounded, searched up to MAX_SCAN_DAYS). Placement always avoids `occupied`.
  for (const t of plain) {
    // Re-ranker seam: enumerate the feasible set, let the re-ranker re-order it
    // by preference, then take its first choice. The identity re-ranker leaves
    // the EDF earliest-fit order intact, so output is unchanged from `findSlot`.
    const candidates = feasibleSlots(
      prefs,
      t.durationMinutes,
      t.deadline,
      occupied,
      now,
    );
    const slot = reRanker.score(t, candidates)[0] ?? null;
    if (slot) {
      occupied.push({
        start: slot.getTime(),
        end: slot.getTime() + durationMs(t.durationMinutes),
      });
      out.push({ id: t.id, scheduledStartTime: slot, conflict: false });
    } else {
      out.push({ id: t.id, scheduledStartTime: null, conflict: true });
    }
  }

  // Final overlap pass: CONFLICT DETECTION is now-independent. Every placed task
  // — anchors, freshly packed flexible tasks, AND frozen past tasks — has its
  // `conflict` recomputed from pure pairwise half-open-interval overlap across
  // the whole placement set, regardless of `now`/elapsed/past. A conflict means
  // "two tasks overlap in time" anywhere in the window, so a past–past or
  // past–in-progress overlap that lies before `now` is flagged just like a live
  // one (and self-heals when the overlap is gone). Unplaced tasks keep the
  // conflict verdict assigned above.
  //
  // PLACEMENT stays now-aware: this pass only writes each task's `conflict`
  // flag. Frozen past tasks (and anchors) keep their stored `scheduledStartTime`
  // — only non-anchored live tasks were ever (re)positioned, above.
  const durationById = new Map<string, number>(
    tasks.map((t) => [t.id, t.durationMinutes]),
  );
  for (const p of out) {
    if (p.scheduledStartTime === null) continue; // unplaced — keep verdict
    const dur = durationById.get(p.id);
    if (dur === undefined) continue;
    const iv = {
      start: p.scheduledStartTime.getTime(),
      end: p.scheduledStartTime.getTime() + durationMs(dur),
    };
    p.conflict = out.some((o) => {
      if (o.id === p.id || o.scheduledStartTime === null) return false;
      const oDur = durationById.get(o.id);
      if (oDur === undefined) return false;
      const oStart = o.scheduledStartTime.getTime();
      const oiv = { start: oStart, end: oStart + durationMs(oDur) };
      return iv.start < oiv.end && oiv.start < iv.end;
    });
  }
  return out;
}
