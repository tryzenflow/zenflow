import { MAX_SCAN_DAYS, MIN } from "./constants";
import { EdfTask, SchedulerPrefs, Placement } from "./interfaces";
import { identityReRanker, SlotReRanker } from "./reranker";

// Re-export the scheduler's public types so consumers can import them from "./edf".
export type { EdfTask, SchedulerPrefs };
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
 * EDF ordering: effective deadline ascending (nulls last), then createdAt
 * ascending. The effective deadline is the earlier of the user-set `deadline`
 * and the period ceiling `schedulingDeadline` — for tasks that have only a
 * `schedulingDeadline` (period-bounded, no user deadline) this gives them a
 * real urgency rank instead of lumping them with fully-unbounded legacy tasks
 * at +Infinity. A task with BOTH fields always uses `deadline` first (it is
 * always ≤ `schedulingDeadline` by construction: `toEdfTask` only sets
 * `schedulingDeadline` when `deadline === null`).
 */
export function compareEdf(a: EdfTask, b: EdfTask): number {
  const ad = (a.deadline ?? a.schedulingDeadline)?.getTime() ?? Infinity;
  const bd = (b.deadline ?? b.schedulingDeadline)?.getTime() ?? Infinity;
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
 * An anchored task keeps its stored slot through {@link scheduleAll}: a `fixed`
 * task, or a flexible task the user manually dragged/resized (`manuallyMoved`).
 * Both are passed through as occupied space; only the remaining flexible,
 * non-anchored, non-past tasks get EDF-packed.
 */
function isAnchored(t: EdfTask): boolean {
  return (t.fixed || t.manuallyMoved) && t.scheduledStartTime !== null;
}

/**
 * Full deterministic re-schedule of all PENDING tasks. Fixed and manually-moved
 * tasks keep their anchored slot. The remaining flexible tasks are EDF-packed
 * from `now` around everything already occupied — closer deadlines win earlier
 * slots, later ones cascade. Used on preference changes and on the create /
 * deadline-edit cascade.
 */
export function scheduleAll(
  prefs: SchedulerPrefs,
  tasks: EdfTask[],
  now: Date,
  reRanker: SlotReRanker = identityReRanker,
): Placement[] {
  // Past tasks are frozen: never moved, never re-flagged, and excluded from the
  // occupied set so they can't block or displace future placements.
  const past = tasks.filter((t) => isPast(t, now));
  const live = tasks.filter((t) => !isPast(t, now));

  // Fixed + manually-moved tasks are anchors; everything else is EDF-packed.
  const anchored = live.filter(isAnchored);
  const plain = live.filter((t) => !isAnchored(t)).sort(compareEdf);

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

  // Anchors pass through with their stored slot. Their conflict verdict is NOT
  // decided here — a fixed task's user-chosen time and a manually-moved flexible
  // task's dragged slot are both allowed to overlap something, and that overlap
  // must surface. The real pairwise check happens below, after the flexible
  // tasks are packed, so an anchor-vs-anchor or anchor-vs-flexible overlap is
  // flagged on both sides.
  out.push(
    ...anchored.map((t) => ({
      id: t.id,
      scheduledStartTime: t.scheduledStartTime,
      conflict: false,
    })),
  );

  // Flexible tasks fill the gaps with EDF packing. The FLOOR and the CEILING are
  // independent and both apply to a no-deadline task:
  //   floor (earliest): a deadline-bearing task is packed from `now` (urgency
  //     dominates — its create-day anchor is ignored); a no-deadline task is
  //     floored at its stored `schedulingAnchor` so it lands on/after its create
  //     day. `findSlot` clamps the floor up to `now`, so a past anchor is inert.
  //   ceiling (the deadline arg to findSlot): the user `deadline` if any, else
  //     the task's `schedulingDeadline` (the end of its viewed period), else
  //     null (unbounded — legacy behavior). A no-deadline task is thus packed
  //     within `[anchor, periodEnd]`: if no working-hours slot fits before the
  //     period ends it comes back unplaced (conflict) rather than rolling into a
  //     later period — and STAYS unplaced across re-packs (the ceiling persists).
  // A user-deadline task is byte-for-byte unchanged (floor undefined, ceiling =
  // its deadline). Flexible placement always avoids `occupied`.
  for (const t of plain) {
    const earliest = t.deadline ? undefined : (t.schedulingAnchor ?? undefined);
    const ceiling = t.deadline ?? t.schedulingDeadline ?? null;
    // Re-ranker seam: enumerate the feasible set, let the re-ranker re-order it
    // by preference, then take its first choice. The identity re-ranker leaves
    // the EDF earliest-fit order intact, so output is unchanged from `findSlot`.
    const candidates = feasibleSlots(
      prefs,
      t.durationMinutes,
      ceiling,
      occupied,
      now,
      earliest,
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
