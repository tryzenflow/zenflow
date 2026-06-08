import { MAX_SCAN_DAYS, MIN } from "./constants";
import { EdfTask, SchedulerPrefs, Placement } from "./interfaces";

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
 */
export function findSlot(
  prefs: SchedulerPrefs,
  durationMinutes: number,
  deadline: Date | null,
  occupied: Interval[],
  now: Date,
  earliest?: Date,
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
    if (!prefs.workDays.includes(isoWeekday(dateStr))) continue;

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
 * Full deterministic re-schedule of all PENDING tasks. Fixed tasks keep their
 * anchored slot. Flexible tasks are EDF-packed from `now` around everything
 * already occupied. Used on preference changes (docs: "PUT preferences triggers
 * full EDF rescheduling").
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
  const plain = live.filter((t) => !t.fixed).sort(compareEdf);

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

  // Flexible tasks fill the gaps with the usual EDF-from-now packing.
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
  );
  return slot
    ? { id: task.id, scheduledStartTime: slot, conflict: false }
    : { id: task.id, scheduledStartTime: null, conflict: true };
}
