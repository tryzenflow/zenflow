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

/**
 * Pure, deterministic Earliest-Deadline-First scheduling core (Phase 1).
 * No I/O, no randomness — same inputs always produce the same schedule, which
 * makes this directly unit-testable. The NestJS SchedulerService wraps these
 * with persistence, audit events, and penalty-matrix telemetry.
 */

export interface SchedulerPrefs {
  workStart: number; // minutes from midnight
  workEnd: number;
  workDays: number[]; // ISO 1=Mon … 7=Sun
  timezone: string; // IANA
}

export interface EdfTask {
  id: string;
  durationMinutes: number;
  deadline: Date | null;
  fixed: boolean;
  scheduledStartTime: Date | null;
  createdAt: Date;
}

export interface Placement {
  id: string;
  scheduledStartTime: Date | null;
  conflict: boolean;
}

/** How far ahead the engine will scan for an open slot for deadline-less tasks. */
export const MAX_SCAN_DAYS = 90;
/** Safety bound on cascade depth (≫ slots in any realistic horizon). */
export const MAX_CASCADE_STEPS = 500;

const MIN = 60_000;

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

  for (let d = 0; d <= MAX_SCAN_DAYS; d++) {
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
 * anchored slot; flexible tasks are EDF-placed around them. Used on preference
 * changes (docs: "PUT preferences triggers full EDF rescheduling").
 */
export function scheduleAll(
  prefs: SchedulerPrefs,
  tasks: EdfTask[],
  now: Date,
): Placement[] {
  const fixed = tasks.filter((t) => t.fixed && t.scheduledStartTime);
  const flexible = tasks.filter((t) => !t.fixed).sort(compareEdf);

  const occupied: Interval[] = fixed
    .map(intervalOf)
    .filter((i): i is Interval => i !== null);

  const out: Placement[] = fixed.map((t) => ({
    id: t.id,
    scheduledStartTime: t.scheduledStartTime,
    conflict: false,
  }));

  for (const t of flexible) {
    const slot = findSlot(prefs, t.durationMinutes, t.deadline, occupied, now);
    if (slot) {
      occupied.push({ start: slot.getTime(), end: slot.getTime() + durationMs(t.durationMinutes) });
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
  const occupied = others
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

interface OccBlock {
  id: string;
  start: number;
  end: number;
  fixed: boolean;
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
    const iv = intervalOf(t);
    if (iv) occ.push({ id: t.id, start: iv.start, end: iv.end, fixed: t.fixed });
  }
  const asIntervals = (exclude?: string): Interval[] =>
    occ.filter((o) => o.id !== exclude).map((o) => ({ start: o.start, end: o.end }));

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

  target.scheduledStartTime = targetStart === null ? null : new Date(targetStart);
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
    occ.push({ id: target.id, start: targetStart, end: tEnd, fixed: target.fixed });
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
