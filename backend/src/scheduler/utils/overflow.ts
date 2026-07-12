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
import { minutesToUtc } from "../../common/utils";
import { intervalOf, scheduleAll } from "./edf";
import { SchedulingOverflow } from "@zenflow/shared";

/**
 * Pure overflow-recovery core (docs/heuristic.md / todo.md §Overflow Handling).
 * Both recovery options are computed relative to `now`/the task's own deadline
 * — they never invent a slot that overlaps `occupied`, but they DO relax
 * either the work-hours window (outsideHours) or the deadline (nextAvailable).
 */

/**
 * Earliest feasible slot for `task` ignoring the work-hours window entirely
 * (still respecting `occupied`), scanning forward from `now` on the 15-min
 * grid. Among the feasible gaps found on a given day, prefers the one CLOSEST
 * to that day's working-hours region (measured to the window's start/end; a
 * gap that overlaps the window itself has distance 0) rather than an
 * arbitrary midnight-adjacent gap. Advances day-by-day (up to
 * {@link MAX_SCAN_DAYS}) if a day has no feasible gap at all; returns null only
 * if every day in that horizon is fully booked.
 */
export function findSlotIgnoringWorkHours(
  task: EdfTask,
  now: Date,
  occupied: Interval[],
  prefs: SchedulerPrefs,
): Interval | null {
  const durationMs = task.durationMinutes * MS_PER_MINUTE;
  let floor = ceilToSlot(now.getTime());

  for (let i = 0; i < MAX_SCAN_DAYS; i++) {
    const dateStr = localDateStr(new Date(floor), prefs.timezone);
    const dayStart = minutesToUtc(dateStr, 0, prefs.timezone).getTime();
    const dayEnd = minutesToUtc(
      addDaysStr(dateStr, 1),
      0,
      prefs.timezone,
    ).getTime();
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
    floor = dayEnd; // this day is fully booked — advance
  }

  return null;
}

/**
 * Earliest in-WORK-HOURS slot at/after `searchFrom`, ignoring `task.deadline`
 * entirely (the deadline may already be overdue). Scans day-by-day up to
 * {@link MAX_SCAN_DAYS}; returns null if none is found in that horizon.
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

/** Both recovery options, packaged for the overflow toast. */
export function computeOverflowOptions(
  task: EdfTask,
  now: Date,
  occupied: Interval[],
  prefs: SchedulerPrefs,
): { outsideHours: Interval | null; nextAvailable: Interval | null } {
  return {
    outsideHours: findSlotIgnoringWorkHours(task, now, occupied, prefs),
    nextAvailable: findNextAvailableSlot(
      task,
      task.deadline ?? now,
      occupied,
      prefs,
    ),
  };
}

/**
 * Apply the user's accepted overflow-recovery choice: pin `task` at
 * `chosenSlot` (`manuallyMoved: true` — the confirmed product decision that an
 * accepted overflow override IS the "don't move this again" mechanism), then
 * re-pack every OTHER movable task now that `task`'s interval occupies space.
 * If that repack produces a NEW conflict on some other task (a secondary
 * overflow), it is recursively auto-healed via {@link findSlotIgnoringWorkHours}
 * (never {@link findNextAvailableSlot} — the auto-heal relaxes work-hours
 * preference, never the deadline) instead of surfacing another prompt. Bounded
 * by a total step budget so a pathologically full calendar can't loop forever;
 * if the cap is hit, the deepest-still-unplaced task is left `conflict: true`.
 */
export function applyOverflowChoice(
  choice: "outsideHours" | "nextAvailable",
  task: EdfTask,
  chosenSlot: Interval,
  allTasks: EdfTask[],
  prefs: SchedulerPrefs,
  now: Date,
): { placements: Placement[]; displaced: Placement[] } {
  void choice; // both choices apply identically once a concrete slot is chosen

  const state = new Map<string, EdfTask>(allTasks.map((t) => [t.id, t]));
  state.set(task.id, {
    ...task,
    manuallyMoved: true,
    scheduledStartTime: new Date(chosenSlot.start),
    conflict: false,
  });

  const displacedIds = new Set<string>();
  const changed = new Map<string, Placement>();
  changed.set(task.id, {
    id: task.id,
    scheduledStartTime: new Date(chosenSlot.start),
    conflict: false,
    manuallyMoved: true,
  });

  const MAX_HEAL_STEPS = MAX_SCAN_DAYS;
  let steps = 0;
  let dirty = true;
  const healScope: CascadeScope = {
    windowStart: now,
    windowEnd: new Date(now.getTime() + MAX_SCAN_DAYS * 24 * 60 * 60 * 1000),
  };

  while (dirty && steps < MAX_HEAL_STEPS) {
    dirty = false;
    steps += 1;

    const placements = scheduleAll(prefs, [...state.values()], healScope);
    const conflicted: Placement[] = [];

    for (const p of placements) {
      const prevTask = state.get(p.id)!;
      const moved =
        (p.scheduledStartTime?.getTime() ?? null) !==
          (prevTask.scheduledStartTime?.getTime() ?? null) ||
        p.conflict !== prevTask.conflict;

      state.set(p.id, {
        ...prevTask,
        scheduledStartTime: p.scheduledStartTime,
        conflict: p.conflict,
        manuallyMoved: p.manuallyMoved,
      });

      if (moved && p.id !== task.id) {
        displacedIds.add(p.id);
        changed.set(p.id, p);
      }
      if (p.conflict && p.id !== task.id) conflicted.push(p);
    }

    for (const c of conflicted) {
      const occupied = [...state.values()]
        .filter((t) => t.id !== c.id)
        .map((t) => intervalOf(t))
        .filter((iv): iv is Interval => iv !== null);
      const healed = findSlotIgnoringWorkHours(
        state.get(c.id)!,
        now,
        occupied,
        prefs,
      );
      if (!healed) continue; // cap hit / truly unplaceable — leave conflict: true

      const healedTask: EdfTask = {
        ...state.get(c.id)!,
        manuallyMoved: true,
        scheduledStartTime: new Date(healed.start),
        conflict: false,
      };
      state.set(c.id, healedTask);
      displacedIds.add(c.id);
      changed.set(c.id, {
        id: c.id,
        scheduledStartTime: healedTask.scheduledStartTime,
        conflict: false,
        manuallyMoved: true,
      });
      dirty = true;
    }
  }

  const allPlacements: Placement[] = [...state.values()].map((t) => ({
    id: t.id,
    scheduledStartTime: t.scheduledStartTime,
    conflict: t.conflict,
    manuallyMoved: t.manuallyMoved,
  }));
  const displaced = [...displacedIds].map((id) => changed.get(id)!);

  return { placements: allPlacements, displaced };
}

export function toOverflow(result: {
  outsideHours: { start: number } | null;
  nextAvailable: { start: number } | null;
}): SchedulingOverflow {
  return {
    outsideHours: result.outsideHours
      ? {
          scheduledStartTime: new Date(result.outsideHours.start).toISOString(),
        }
      : null,
    nextAvailable: result.nextAvailable
      ? {
          scheduledStartTime: new Date(
            result.nextAvailable.start,
          ).toISOString(),
        }
      : null,
  };
}
