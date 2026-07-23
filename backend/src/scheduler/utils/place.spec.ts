import { PREFERENCE_MATRIX_LENGTH } from "@zenflow/shared";
import {
  feasibleSlots,
  findNextAvailableSlot,
  findSlotIgnoringWorkHours,
  intervalOf,
  isOverdue,
  isPast,
  placeTask,
} from "./place";
import type { EdfTask, SchedulerPrefs } from "../interfaces";
import {
  addDaysStr,
  preferenceIndex,
  workWindowFor,
  type Interval,
} from "./slot";
import { MAX_SCAN_DAYS } from "../constants";

/**
 * Pure single-task placer coverage (docs/heuristic.md, CLAUDE.md invariant
 * #2). `placeTask`'s tier selection is the most important pure function in
 * the codebase now that the whole-backlog cost-model solver is gone — see
 * the `placeTask` describe block below.
 *
 * 2026-06-08 is a Monday — a fixed UTC anchor keeps every test's wall-clock
 * math trivial (UTC user ⇒ 'YYYY-MM-DD' local date == the UTC calendar date).
 */

const DAY = "2026-06-08"; // Monday
const prefs: SchedulerPrefs = {
  workStart: 540, // 09:00
  workEnd: 1020, // 17:00
  workDays: [1, 2, 3, 4, 5],
  timezone: "UTC",
};

function at(hhmm: string, dayOffset = 0): Date {
  const dateStr = addDaysStr(DAY, dayOffset);
  return new Date(`${dateStr}T${hhmm}:00.000Z`);
}

function task(overrides: Partial<EdfTask> & { id: string }): EdfTask {
  return {
    durationMinutes: 60,
    deadline: null,
    manuallyMoved: false,
    scheduledStartTime: null,
    createdAt: at("00:00"),
    conflict: false,
    ...overrides,
  };
}

describe("intervalOf — null-safety", () => {
  it("returns null for an unplaced task", () => {
    expect(
      intervalOf({ scheduledStartTime: null, durationMinutes: 60 }),
    ).toBeNull();
  });

  it("maps a placed task to its occupied interval", () => {
    const start = at("09:00");
    const iv = intervalOf({ scheduledStartTime: start, durationMinutes: 30 });
    expect(iv).toEqual({
      start: start.getTime(),
      end: start.getTime() + 30 * 60_000,
    });
  });
});

describe("isPast — frozen/in-progress test", () => {
  const now = at("10:00");

  it("is false for an unplaced task", () => {
    expect(isPast(task({ id: "a", scheduledStartTime: null }), now)).toBe(
      false,
    );
  });

  it("is true for a task already started (in progress)", () => {
    expect(
      isPast(
        task({ id: "a", scheduledStartTime: at("09:30"), durationMinutes: 60 }),
        now,
      ),
    ).toBe(true);
  });

  it("is true for a fully elapsed task", () => {
    expect(
      isPast(
        task({ id: "a", scheduledStartTime: at("08:00"), durationMinutes: 60 }),
        now,
      ),
    ).toBe(true);
  });

  it("is false for a task starting in the future", () => {
    expect(
      isPast(
        task({ id: "a", scheduledStartTime: at("10:30"), durationMinutes: 60 }),
        now,
      ),
    ).toBe(false);
  });
});

describe("isOverdue", () => {
  const now = at("13:00");

  it("is false for a task with no deadline", () => {
    expect(isOverdue(task({ id: "a", deadline: null }), now)).toBe(false);
  });

  it("is false for a deadline still in the future", () => {
    expect(isOverdue(task({ id: "a", deadline: at("17:00") }), now)).toBe(
      false,
    );
  });

  it("is true for a deadline that has already passed", () => {
    expect(isOverdue(task({ id: "a", deadline: at("09:00") }), now)).toBe(true);
  });

  it("is true for a deadline exactly at now", () => {
    expect(isOverdue(task({ id: "a", deadline: now }), now)).toBe(true);
  });
});

describe("feasibleSlots", () => {
  it("enumerates every 15-min-aligned start within the work window before the deadline", () => {
    const now = at("08:00");
    const t = task({ id: "a", durationMinutes: 60, deadline: at("17:00") });
    const slots = feasibleSlots(t, now, prefs, []);
    // 09:00 .. 16:00 inclusive, every 15 min → 29 candidates.
    expect(slots).toHaveLength(29);
    expect(new Date(slots[0].start).toISOString()).toBe(
      at("09:00").toISOString(),
    );
    expect(new Date(slots[slots.length - 1].start).toISOString()).toBe(
      at("16:00").toISOString(),
    );
  });

  it("excludes candidates overlapping occupied intervals", () => {
    const now = at("08:00");
    const t = task({ id: "a", durationMinutes: 60, deadline: at("17:00") });
    const occupied: Interval[] = [
      { start: at("09:00").getTime(), end: at("10:00").getTime() },
    ];
    const slots = feasibleSlots(t, now, prefs, occupied);
    expect(new Date(slots[0].start).toISOString()).toBe(
      at("10:00").toISOString(),
    );
  });

  it("returns nothing when the deadline is tighter than the duration", () => {
    const now = at("16:30");
    const t = task({ id: "a", durationMinutes: 60, deadline: at("17:00") });
    expect(feasibleSlots(t, now, prefs, [])).toEqual([]);
  });

  it("is cross-midnight-aware: a wrapping work window lets the candidate END land after local midnight", () => {
    const wrapPrefs: SchedulerPrefs = {
      ...prefs,
      workStart: 1320,
      workEnd: 180,
    }; // 22:00 → 03:00
    const now = at("21:00");
    const t = task({ id: "a", durationMinutes: 120, deadline: at("04:00", 1) });
    const slots = feasibleSlots(t, now, wrapPrefs, []);
    expect(slots.length).toBeGreaterThan(0);
    // Last candidate must still respect the wrap-aware end (03:00 next day),
    // never a bare same-day midnight boundary.
    const last = slots[slots.length - 1];
    expect(new Date(last.end).toISOString()).toBe(at("03:00", 1).toISOString());
    expect(new Date(last.start).toISOString()).toBe(
      at("01:00", 1).toISOString(),
    );
  });

  it("bounds a no-deadline task to now + MAX_SCAN_DAYS, returning [] when every day in that horizon is fully booked", () => {
    const now = at("08:00");
    const t = task({ id: "a", durationMinutes: 60, deadline: null });

    // Fully occupy the work window of every day across the whole scan horizon.
    const occupied: Interval[] = [];
    let d = DAY;
    for (let i = 0; i <= MAX_SCAN_DAYS + 1; i++) {
      const win = workWindowFor(
        d,
        prefs.workStart,
        prefs.workEnd,
        prefs.timezone,
      );
      occupied.push({ start: win.start, end: win.end });
      d = addDaysStr(d, 1);
    }

    expect(feasibleSlots(t, now, prefs, occupied)).toEqual([]);
  });
});

describe("findSlotIgnoringWorkHours", () => {
  it("prefers the gap closest to the work-hours region when scanning before work starts", () => {
    // now = 02:00, work starts 09:00 → the closest-to-work-hours gap is the
    // one immediately preceding 09:00, not the earliest (02:00) gap.
    const now = at("02:00");
    const t = task({ id: "a", durationMinutes: 60 });
    const slot = findSlotIgnoringWorkHours(t, now, [], prefs)!;
    expect(slot).not.toBeNull();
    expect(new Date(slot.end).toISOString()).toBe(at("09:00").toISOString());
  });

  it("places right after floor when already past work hours for the day", () => {
    const now = at("20:00"); // well past 17:00 work end
    const t = task({ id: "a", durationMinutes: 60 });
    const slot = findSlotIgnoringWorkHours(t, now, [], prefs)!;
    expect(new Date(slot.start).toISOString()).toBe(at("20:00").toISOString());
  });

  it("advances to the next day when the first day is completely full", () => {
    const now = at("02:00");
    // Occupy the entire day (00:00 → 24:00) so nothing fits before midnight.
    const occupied: Interval[] = [
      { start: at("00:00").getTime(), end: at("00:00", 1).getTime() },
    ];
    const t = task({ id: "a", durationMinutes: 60 });
    const slot = findSlotIgnoringWorkHours(t, now, occupied, prefs)!;
    expect(slot).not.toBeNull();
    expect(new Date(slot.start).getTime()).toBeGreaterThanOrEqual(
      at("00:00", 1).getTime(),
    );
  });

  it("keeps advancing across multiple fully-booked days until one has room", () => {
    const now = at("02:00");
    const occupied: Interval[] = [
      { start: at("00:00").getTime(), end: at("00:00", 1).getTime() },
      { start: at("00:00", 1).getTime(), end: at("00:00", 2).getTime() },
      { start: at("00:00", 2).getTime(), end: at("00:00", 3).getTime() },
    ];
    const t = task({ id: "a", durationMinutes: 60 });
    const slot = findSlotIgnoringWorkHours(t, now, occupied, prefs)!;
    expect(slot).not.toBeNull();
    expect(new Date(slot.start).getTime()).toBeGreaterThanOrEqual(
      at("00:00", 3).getTime(),
    );
  });

  it("returns null when every day in the scan horizon is fully booked (no ceiling)", () => {
    const now = at("02:00");
    const occupied: Interval[] = [];
    let d = DAY;
    for (let i = 0; i <= 92; i++) {
      occupied.push({
        start: new Date(`${d}T00:00:00.000Z`).getTime(),
        end: new Date(`${addDaysStr(d, 1)}T00:00:00.000Z`).getTime(),
      });
      d = addDaysStr(d, 1);
    }
    const t = task({ id: "a", durationMinutes: 60 });
    expect(findSlotIgnoringWorkHours(t, now, occupied, prefs)).toBeNull();
  });

  it("never returns a slot overlapping an occupied interval", () => {
    const now = at("08:00");
    const occupied: Interval[] = [
      { start: at("09:00").getTime(), end: at("10:00").getTime() },
    ];
    const t = task({ id: "a", durationMinutes: 30 });
    const slot = findSlotIgnoringWorkHours(t, now, occupied, prefs)!;
    const overlaps =
      slot.start < occupied[0].end && slot.end > occupied[0].start;
    expect(overlaps).toBe(false);
  });

  describe("the optional `ceiling` bound (a deadline)", () => {
    it("never returns a slot at/after the ceiling", () => {
      const now = at("02:00");
      const t = task({ id: "a", durationMinutes: 60 });
      const ceiling = at("05:00").getTime(); // well before work hours
      const slot = findSlotIgnoringWorkHours(t, now, [], prefs, ceiling);
      expect(slot).not.toBeNull();
      expect(slot!.end).toBeLessThanOrEqual(ceiling);
    });

    it("returns null once the search floor reaches the ceiling with no room found", () => {
      const now = at("02:00");
      const t = task({ id: "a", durationMinutes: 60 });
      // A 30-min ceiling can't fit a 60-min task at all.
      const ceiling = at("02:30").getTime();
      expect(findSlotIgnoringWorkHours(t, now, [], prefs, ceiling)).toBeNull();
    });

    it("clips the within-day upper bound to the ceiling, not just that day's midnight", () => {
      const now = at("02:00");
      const t = task({ id: "a", durationMinutes: 60 });
      // Occupy right up to 04:00 so the only remaining same-day room before
      // midnight would be 04:00 onward — but the ceiling (04:30) only leaves
      // a 30-min gap, not enough for a 60-min task, so it must roll to the
      // NEXT ceiling-bounded day rather than incorrectly using 04:00-24:00.
      const occupied: Interval[] = [
        { start: at("00:00").getTime(), end: at("04:00").getTime() },
      ];
      const ceiling = at("04:30").getTime();
      expect(
        findSlotIgnoringWorkHours(t, now, occupied, prefs, ceiling),
      ).toBeNull();
    });

    it("omitted entirely, behaves exactly as the unbounded scan (backward compatible)", () => {
      const now = at("20:00");
      const t = task({ id: "a", durationMinutes: 60 });
      const withCeiling = findSlotIgnoringWorkHours(
        t,
        now,
        [],
        prefs,
        undefined,
      );
      const withoutCeiling = findSlotIgnoringWorkHours(t, now, [], prefs);
      expect(withCeiling).toEqual(withoutCeiling);
    });
  });
});

describe("findNextAvailableSlot", () => {
  it("finds the earliest in-work-hours slot at/after searchFrom, ignoring the deadline", () => {
    const t = task({ id: "a", durationMinutes: 60, deadline: at("10:00") }); // already "overdue"
    const slot = findNextAvailableSlot(t, at("08:00"), [], prefs)!;
    expect(new Date(slot.start).toISOString()).toBe(at("09:00").toISOString());
  });

  it("rolls to the next work day when today's window is full", () => {
    const occupied: Interval[] = [
      { start: at("09:00").getTime(), end: at("17:00").getTime() },
    ];
    const t = task({ id: "a", durationMinutes: 60 });
    const slot = findNextAvailableSlot(t, at("08:00"), occupied, prefs)!;
    // Tuesday (next workday).
    expect(new Date(slot.start).toISOString()).toBe(
      at("09:00", 1).toISOString(),
    );
  });

  it("skips non-work days (weekend)", () => {
    // Friday evening search → next slot must be Monday, not Saturday/Sunday.
    const friday = "2026-06-12";
    const searchFrom = new Date(`${friday}T18:00:00.000Z`);
    const t = task({ id: "a", durationMinutes: 60 });
    const slot = findNextAvailableSlot(t, searchFrom, [], prefs)!;
    expect(new Date(slot.start).toISOString()).toBe(
      new Date("2026-06-15T09:00:00.000Z").toISOString(), // the following Monday
    );
  });
});

describe("placeTask", () => {
  it("Tier 1: earliest-first on cold start (no matrix)", () => {
    const now = at("08:00");
    const t = task({ id: "a", deadline: at("17:00"), durationMinutes: 60 });
    const result = placeTask(t, now, prefs, []);
    expect(result.tier).toBe("tier1-earliest");
    expect(result.interval).toEqual({
      start: at("09:00").getTime(),
      end: at("10:00").getTime(),
    });
    expect(result.propensity).toEqual(expect.any(Number));
  });

  it("Tier 1: routes to a liked (but non-earliest) slot when the preference matrix has signal", () => {
    const now = at("08:00");
    const t = task({ id: "a", deadline: at("17:00"), durationMinutes: 60 });
    const matrix = new Array<number>(PREFERENCE_MATRIX_LENGTH).fill(0);
    matrix[preferenceIndex(at("13:00"), prefs.timezone)] = 5;

    const result = placeTask(t, now, prefs, [], matrix);
    expect(result.tier).toBe("tier1-preference");
    // The whole 13:00-14:00 hour bucket shares the same score (5) — the
    // stochastic softmax/Gumbel pick lands somewhere in it, not necessarily
    // exactly on the hour.
    expect(new Date(result.interval!.start).getUTCHours()).toBe(13);
  });

  it("Tier 2: falls through to an outside-hours slot when Tier 1 is exhausted but the deadline still allows one", () => {
    const now = at("16:45");
    const t = task({ id: "a", durationMinutes: 60, deadline: at("20:00") });
    // No in-hours room left today (16:45-17:00 too short); occupy nothing else.
    const result = placeTask(t, now, prefs, []);
    expect(result.tier).toBe("tier2");
    expect(result.interval).not.toBeNull();
    expect(result.interval!.end).toBeLessThanOrEqual(t.deadline!.getTime());
    expect(result.propensity).toBeUndefined();
  });

  it("Tier 3: falls through to a past-deadline in-hours slot once Tier 2 is also exhausted", () => {
    const now = at("16:45");
    const t = task({ id: "a", durationMinutes: 60, deadline: at("17:00") });
    const result = placeTask(t, now, prefs, []);
    expect(result.tier).toBe("tier3");
    expect(result.interval).not.toBeNull();
    expect(new Date(result.interval!.start).getTime()).toBeGreaterThan(
      t.deadline!.getTime(),
    );
  });

  it("unplaced: a genuinely saturated calendar returns { interval: null, tier: 'unplaced' }", () => {
    const now = at("08:00");
    const t = task({ id: "a", deadline: at("17:00"), durationMinutes: 60 });

    const occupied: Interval[] = [];
    let d = DAY;
    for (let i = 0; i <= MAX_SCAN_DAYS + 1; i++) {
      occupied.push({
        start: new Date(`${d}T00:00:00.000Z`).getTime(),
        end: new Date(`${addDaysStr(d, 1)}T00:00:00.000Z`).getTime(),
      });
      d = addDaysStr(d, 1);
    }

    const result = placeTask(t, now, prefs, occupied);
    expect(result).toEqual({ interval: null, tier: "unplaced" });
  });

  it("never lands on top of an occupied interval", () => {
    const now = at("08:00");
    const t = task({ id: "a", deadline: at("17:00"), durationMinutes: 60 });
    const occupied: Interval[] = [
      { start: at("09:00").getTime(), end: at("16:00").getTime() },
    ];
    const result = placeTask(t, now, prefs, occupied);
    expect(result.interval!.start).toBe(at("16:00").getTime());
  });

  describe("determinism — no churn", () => {
    it("placing the same task twice with identical inputs yields the identical slot", () => {
      const now = at("08:00");
      const t = task({ id: "a", deadline: at("17:00"), durationMinutes: 60 });
      const matrix = new Array<number>(PREFERENCE_MATRIX_LENGTH).fill(0);
      matrix[preferenceIndex(at("13:00"), prefs.timezone)] = 5;

      const first = placeTask(
        { ...t },
        new Date(now.getTime()),
        prefs,
        [],
        [...matrix],
      );
      const second = placeTask(
        { ...t },
        new Date(now.getTime()),
        prefs,
        [],
        [...matrix],
      );
      expect(second).toEqual(first);
    });

    it("never displaces or considers another task — occupied space only ever blocks, never gets evicted", () => {
      const now = at("08:00");
      const t = task({ id: "a", deadline: at("17:00"), durationMinutes: 60 });
      const otherTasksAnchor: Interval = {
        start: at("09:00").getTime(),
        end: at("10:00").getTime(),
      };
      const result = placeTask(t, now, prefs, [otherTasksAnchor]);
      // Routes around the occupied slot; nothing about it "evicts" that slot.
      expect(result.interval!.start).not.toBe(otherTasksAnchor.start);
      expect(
        result.interval!.start < otherTasksAnchor.end &&
          otherTasksAnchor.start < result.interval!.end,
      ).toBe(false);
    });
  });
});
