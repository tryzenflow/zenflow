import { MAX_CASCADE_STEPS, MAX_SCAN_DAYS, MIN } from "./constants";
import { EdfTask, SchedulerPrefs, Placement, OccBlock } from "./interfaces";

// Re-export the scheduler's public types so consumers can import them from "./edf".
export type { EdfTask, SchedulerPrefs };
import { minutesToUtc } from "../common/utils";
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
 * conflict by any scheduling path, and they are excluded from the occupied set
 * that drives placement/conflict for non-past tasks (a past block can never
 * legitimately block a future slot — `findSlot` clamps every candidate to
 * `now`). A task with no `scheduledStartTime` is never past. An in-progress
 * task that started before `now` IS past and is left alone.
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

/** EDF ordering: deadline ascending (nulls last), then createdAt ascending. */
export function compareEdf(a: EdfTask, b: EdfTask): number {
  const ad = a.deadline ? a.deadline.getTime() : Infinity;
  const bd = b.deadline ? b.deadline.getTime() : Infinity;
  if (ad !== bd) return ad - bd;
  return a.createdAt.getTime() - b.createdAt.getTime();
}

/**
 * Earliest contiguous work-hours slot of `durationMinutes` that starts at/after
 * `earliest` (and `now`) and ends before `deadline`. Returns null on conflict.
 *
 * With `opts.ignoreWorkDays` the non-working-day skip is suppressed, so a slot
 * can be placed within the work hours of a non-working day. This is only used
 * for recurring occurrences, which are pinned to a single day via
 * `earliest`+`deadline`, so it can only ever consider that one chosen day.
 */
export function findSlot(
  prefs: SchedulerPrefs,
  durationMinutes: number,
  deadline: Date | null,
  occupied: Interval[],
  now: Date,
  earliest?: Date,
  opts: { ignoreWorkDays?: boolean } = {},
): Date | null {
  const tz = prefs.timezone;
  const durMs = durationMs(durationMinutes);
  const lowerMs = Math.max(now.getTime(), earliest ? earliest.getTime() : 0);
  const fromStr = localDateStr(new Date(lowerMs), tz);
  const deadlineMs = deadline ? deadline.getTime() : null;
  const deadlineDateStr = deadline ? localDateStr(deadline, tz) : null;

  // A window that wraps past midnight and started on the *previous* day spills
  // into `now`'s morning, so when it wraps the scan begins one day earlier. The
  // `cand` clamp below keeps every candidate ≥ now/earliest, so the prev-day
  // evening slots that precede `now` are naturally skipped.
  const wraps = prefs.workEnd <= prefs.workStart;
  for (let d = wraps ? -1 : 0; d <= MAX_SCAN_DAYS; d++) {
    const dateStr = addDaysStr(fromStr, d);
    if (deadlineDateStr && dateStr > deadlineDateStr) break;
    if (!opts.ignoreWorkDays && !prefs.workDays.includes(isoWeekday(dateStr)))
      continue;

    const win = workWindowFor(dateStr, prefs.workStart, prefs.workEnd, tz);
    let cand = ceilToSlot(Math.max(win.start, lowerMs));
    for (; cand + durMs <= win.end; cand += SLOT_MS) {
      const candEnd = cand + durMs;
      if (deadlineMs !== null && candEnd > deadlineMs) return null;
      if (!overlapsAny(occupied, cand, candEnd)) return new Date(cand);
    }
  }
  return null;
}

/**
 * True for a materialized recurring occurrence whose intended day is still
 * recoverable (it carries a `seriesId` and a current placement). On a full
 * re-EDF these must stay on their own day rather than EDF-packing forward.
 */
function isDayPinned(t: EdfTask): boolean {
  return !t.fixed && t.seriesId !== null && t.scheduledStartTime !== null;
}

/**
 * Re-place a recurring occurrence pinned to the day of its current
 * `scheduledStartTime`, mirroring the day-pinning `placeNewTask` applies at
 * creation: `earliest` = that day's 00:00 (user tz), deadline capped at
 * min(task.deadline, that day's work-end), `ignoreWorkDays` so a pinned
 * non-working day still resolves. If no slot fits, the occurrence is anchored
 * at that day's work start (as a standing conflict) so it never floats onto a
 * different day.
 */
function placePinnedOccurrence(
  prefs: SchedulerPrefs,
  t: EdfTask,
  occupied: Interval[],
  now: Date,
): Placement {
  const tz = prefs.timezone;
  const dayStr = localDateStr(t.scheduledStartTime!, tz);
  const dayStart = minutesToUtc(dayStr, 0, tz);
  const win = workWindowFor(dayStr, prefs.workStart, prefs.workEnd, tz);
  const dayWorkEnd = new Date(win.end);
  const deadlineCap =
    t.deadline && t.deadline.getTime() < dayWorkEnd.getTime()
      ? t.deadline
      : dayWorkEnd;

  const slot = findSlot(
    prefs,
    t.durationMinutes,
    deadlineCap,
    occupied,
    now,
    dayStart,
    { ignoreWorkDays: true },
  );
  if (slot) return { id: t.id, scheduledStartTime: slot, conflict: false };

  // No slot fit the day (full, in the past, or overflows the work window).
  // Keep the occurrence on its day as a standing conflict rather than letting
  // it drift to another day.
  const anchor = new Date(win.start);
  return { id: t.id, scheduledStartTime: anchor, conflict: true };
}

/**
 * Full deterministic re-schedule of all PENDING tasks. Fixed tasks keep their
 * anchored slot. Recurring occurrences (a `seriesId` plus a current placement)
 * stay pinned to their own day, re-flowing only their time-of-day within that
 * day's work window — so a daily series keeps one-per-day instead of collapsing
 * onto the earliest workdays. Remaining ("plain") flexible tasks are EDF-packed
 * from `now` around everything already occupied. Used on preference changes
 * (docs: "PUT preferences triggers full EDF rescheduling").
 *
 * A recurring occurrence with no current `scheduledStartTime` (previously
 * unplaced/conflict) has no recoverable day, so it is treated as plain flexible.
 */
export function scheduleAll(
  prefs: SchedulerPrefs,
  tasks: EdfTask[],
  now: Date,
): Placement[] {
  // Past tasks are frozen: never moved, never re-flagged, and excluded from the
  // occupied set so they can't block or displace future placements.
  const past = tasks.filter((t) => isPast(t, now));
  const live = tasks.filter((t) => !isPast(t, now));

  const fixed = live.filter((t) => t.fixed && t.scheduledStartTime);
  const pinned = live.filter(isDayPinned).sort(compareEdf);
  const plain = live
    .filter((t) => !t.fixed && !isDayPinned(t))
    .sort(compareEdf);

  const occupied: Interval[] = fixed
    .map(intervalOf)
    .filter((i): i is Interval => i !== null);

  // Frozen past tasks pass through with their stored placement + conflict.
  const out: Placement[] = past.map((t) => ({
    id: t.id,
    scheduledStartTime: t.scheduledStartTime,
    conflict: t.conflict,
  }));

  out.push(
    ...fixed.map((t) => ({
      id: t.id,
      scheduledStartTime: t.scheduledStartTime,
      conflict: false,
    })),
  );

  // Place day-pinned recurring occurrences first, each confined to its own day.
  for (const t of pinned) {
    const p = placePinnedOccurrence(prefs, t, occupied, now);
    if (p.scheduledStartTime) {
      occupied.push({
        start: p.scheduledStartTime.getTime(),
        end: p.scheduledStartTime.getTime() + durationMs(t.durationMinutes),
      });
    }
    out.push(p);
  }

  // Plain flexible tasks fill the gaps with the usual EDF-from-now packing.
  for (const t of plain) {
    const slot = findSlot(prefs, t.durationMinutes, t.deadline, occupied, now);
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
  return out;
}

/**
 * Incremental placement of a single new task around already-placed tasks
 * (preserves existing/ manually-moved placements). Used on POST /tasks.
 * `earliest` lower-bounds the search (e.g. the day the user was viewing), so a
 * flexible task lands on/after that day rather than the first slot from `now`.
 */
export function placeOne(
  prefs: SchedulerPrefs,
  task: EdfTask,
  others: EdfTask[],
  now: Date,
  earliest?: Date,
  opts: { ignoreWorkDays?: boolean } = {},
): Placement {
  if (task.fixed) {
    return {
      id: task.id,
      scheduledStartTime: task.scheduledStartTime,
      conflict: task.scheduledStartTime === null,
    };
  }
  // Past tasks are frozen and can't block a future slot (findSlot clamps every
  // candidate to `now`), so exclude them from the occupied set.
  const occupied = others
    .filter((t) => !isPast(t, now))
    .map(intervalOf)
    .filter((i): i is Interval => i !== null);
  const slot = findSlot(
    prefs,
    task.durationMinutes,
    task.deadline,
    occupied,
    now,
    earliest,
    opts,
  );
  return slot
    ? { id: task.id, scheduledStartTime: slot, conflict: false }
    : { id: task.id, scheduledStartTime: null, conflict: true };
}

/**
 * Cascading realignment for a manual move. Places `targetId` at the snapped
 * `requestedStart`; if that lands on a fixed anchor the incoming task is routed
 * to the next open slot, and any flexible tasks it displaces are re-placed
 * (recursively). Returns the new placement of every task that moved (including
 * the target). Tasks that don't move are omitted.
 */
export function cascadeReschedule(
  prefs: SchedulerPrefs,
  tasks: EdfTask[],
  targetId: string,
  requestedStart: Date,
  now: Date,
): Placement[] {
  const byId = new Map(tasks.map((t) => [t.id, { ...t }]));
  const target = byId.get(targetId);
  if (!target) return [];

  const reqMs = Math.round(requestedStart.getTime() / SLOT_MS) * SLOT_MS;
  const changed = new Map<string, Date | null>();

  const occ: OccBlock[] = [];
  for (const t of byId.values()) {
    if (t.id === targetId) continue;
    // Past tasks are frozen: never evicted, displaced, or re-placed, and they
    // can't occupy a future slot, so leave them out of the scan entirely.
    if (isPast(t, now)) continue;
    const iv = intervalOf(t);
    if (iv)
      occ.push({ id: t.id, start: iv.start, end: iv.end, fixed: t.fixed });
  }
  const asIntervals = (exclude?: string): Interval[] =>
    occ
      .filter((o) => o.id !== exclude)
      .map((o) => ({ start: o.start, end: o.end }));

  // Resolve the target's landing slot.
  let targetStart: number | null = reqMs;
  const targetEnd = reqMs + durationMs(target.durationMinutes);
  const hitsFixed = occ.some(
    (o) => o.fixed && reqMs < o.end && targetEnd > o.start,
  );
  if (hitsFixed) {
    const slot = findSlot(
      prefs,
      target.durationMinutes,
      target.deadline,
      asIntervals(),
      now,
      new Date(reqMs),
    );
    targetStart = slot ? slot.getTime() : null;
  }

  target.scheduledStartTime =
    targetStart === null ? null : new Date(targetStart);
  changed.set(target.id, target.scheduledStartTime);

  const queue: string[] = [];
  if (targetStart !== null) {
    const tEnd = targetStart + durationMs(target.durationMinutes);
    // Evict flexible tasks overlapping the target's new block.
    for (let i = occ.length - 1; i >= 0; i--) {
      const o = occ[i];
      if (!o.fixed && targetStart < o.end && tEnd > o.start) {
        occ.splice(i, 1);
        queue.push(o.id);
      }
    }
    occ.push({
      id: target.id,
      start: targetStart,
      end: tEnd,
      fixed: target.fixed,
    });
  }

  let steps = 0;
  while (queue.length && steps++ < MAX_CASCADE_STEPS) {
    const id = queue.shift()!;
    const t = byId.get(id)!;
    const slot = findSlot(
      prefs,
      t.durationMinutes,
      t.deadline,
      asIntervals(id),
      now,
      t.scheduledStartTime ?? undefined,
    );
    if (slot) {
      const s = slot.getTime();
      const e = s + durationMs(t.durationMinutes);
      // Newly placed block may itself displace others.
      for (let i = occ.length - 1; i >= 0; i--) {
        const o = occ[i];
        if (o.id === id) continue;
        if (!o.fixed && s < o.end && e > o.start) {
          occ.splice(i, 1);
          if (!queue.includes(o.id)) queue.push(o.id);
        }
      }
      const existing = occ.find((o) => o.id === id);
      if (existing) {
        existing.start = s;
        existing.end = e;
      } else {
        occ.push({ id, start: s, end: e, fixed: t.fixed });
      }
      t.scheduledStartTime = slot;
      changed.set(id, slot);
    } else {
      t.scheduledStartTime = null;
      changed.set(id, null);
    }
  }

  return [...changed.entries()].map(([id, scheduledStartTime]) => ({
    id,
    scheduledStartTime,
    conflict: scheduledStartTime === null,
  }));
}
