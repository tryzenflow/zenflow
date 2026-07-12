import { PREFERENCE_MATRIX_LENGTH } from "@zenflow/shared";
import { feasibleSlots, intervalOf, isPast, scheduleAll } from "./edf";
import type { CascadeScope, EdfTask, SchedulerPrefs } from "../interfaces";
import {
  addDaysStr,
  preferenceIndex,
  workWindowFor,
  type Interval,
} from "./slot";
import { MAX_SCAN_DAYS } from "../constants";

/**
 * Pure EDF core coverage (docs/heuristic.md §Phase 1, CLAUDE.md invariant #2).
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

/** An unscoped-equivalent `CascadeScope`: `now` as the floor, a generous window. */
function unscoped(now: Date): CascadeScope {
  return {
    windowStart: now,
    windowEnd: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
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

describe("scheduleAll", () => {
  it("keeps a manually-moved task's slot unchanged and packs a movable task around it", () => {
    const now = at("08:00");
    const manual = task({
      id: "m",
      manuallyMoved: true,
      scheduledStartTime: at("09:00"),
      durationMinutes: 60,
    });
    const movable = task({
      id: "a",
      deadline: at("17:00"),
      durationMinutes: 60,
      createdAt: at("00:01"),
    });
    const placements = scheduleAll(prefs, [manual, movable], unscoped(now));

    const mPlacement = placements.find((p) => p.id === "m")!;
    const aPlacement = placements.find((p) => p.id === "a")!;
    expect(mPlacement.scheduledStartTime?.toISOString()).toBe(
      at("09:00").toISOString(),
    );
    expect(aPlacement.scheduledStartTime?.toISOString()).toBe(
      at("10:00").toISOString(),
    );
    // Frozen passthrough keeps its flag; a freshly-positioned task is not anchored.
    expect(mPlacement.manuallyMoved).toBe(true);
    expect(aPlacement.manuallyMoved).toBe(false);
    // Frozen tasks never get a propensity; a placed movable task always does.
    expect(mPlacement.propensity).toBeUndefined();
    expect(aPlacement.propensity).toEqual(expect.any(Number));
  });

  it("includeManual: true makes a manually-moved task movable too, and clears its manuallyMoved flag once repositioned", () => {
    const now = at("08:00");
    const manual = task({
      id: "m",
      manuallyMoved: true,
      deadline: at("17:00"),
      scheduledStartTime: at("09:00"),
      durationMinutes: 60,
    });
    const scope: CascadeScope = {
      ...unscoped(now),
      includeManual: true,
    };
    const placements = scheduleAll(prefs, [manual], scope);
    const mPlacement = placements.find((p) => p.id === "m")!;
    // Still repositioned to the same earliest feasible slot (nothing else to
    // compete with), but no longer flagged as anchored.
    expect(mPlacement.scheduledStartTime?.toISOString()).toBe(
      at("09:00").toISOString(),
    );
    expect(mPlacement.manuallyMoved).toBe(false);
  });

  it("a fixedTaskId task that is ALSO manuallyMoved is still movable regardless of includeManual", () => {
    const now = at("08:00");
    const fixedAndManual = task({
      id: "m",
      manuallyMoved: true,
      deadline: at("17:00"),
      scheduledStartTime: at("09:00", 5), // stale placement, far away
      durationMinutes: 60,
    });
    const scope: CascadeScope = {
      ...unscoped(now),
      fixedTaskId: "m",
      // includeManual omitted/false — the fixedTaskId override must still apply.
    };
    const placements = scheduleAll(prefs, [fixedAndManual], scope);
    const p = placements.find((x) => x.id === "m")!;
    expect(p.scheduledStartTime?.toISOString()).toBe(at("09:00").toISOString());
    expect(p.manuallyMoved).toBe(false);
  });

  it("freezes an in-progress/past task and seeds it as occupied space", () => {
    const now = at("10:00");
    const past = task({
      id: "p",
      scheduledStartTime: at("09:30"),
      durationMinutes: 60, // in progress: 09:30–10:30
    });
    const movable = task({
      id: "a",
      deadline: at("17:00"),
      durationMinutes: 60,
      createdAt: at("00:01"),
    });
    const placements = scheduleAll(prefs, [past, movable], unscoped(now));

    const pPlacement = placements.find((p) => p.id === "p")!;
    const aPlacement = placements.find((p) => p.id === "a")!;
    expect(pPlacement.scheduledStartTime?.toISOString()).toBe(
      at("09:30").toISOString(),
    );
    // "a" can't start until floor=now(10:00), and 09:30-10:30 is occupied →
    // earliest free slot is 10:30.
    expect(aPlacement.scheduledStartTime?.toISOString()).toBe(
      at("10:30").toISOString(),
    );
  });

  it("freezes tasks currently placed outside the cascade scope's window, except the included task", () => {
    const outside = task({
      id: "outside",
      scheduledStartTime: at("09:00", 5), // far outside the window below
      durationMinutes: 60,
    });
    const scope: CascadeScope = {
      windowStart: at("00:00"),
      windowEnd: at("00:00", 1),
    };
    const placements = scheduleAll(prefs, [outside], scope);
    const p = placements.find((x) => x.id === "outside")!;
    expect(p.scheduledStartTime?.toISOString()).toBe(
      at("09:00", 5).toISOString(),
    );
  });

  it("makes the scope's fixedTaskId movable regardless of its current placement", () => {
    const included = task({
      id: "included",
      scheduledStartTime: at("09:00", 5), // outside the window, but explicitly included
      deadline: at("17:00"),
      durationMinutes: 60,
    });
    const scope: CascadeScope = {
      windowStart: at("00:00"),
      windowEnd: at("00:00", 1),
      fixedTaskId: "included",
    };
    const placements = scheduleAll(prefs, [included], scope);
    const p = placements.find((x) => x.id === "included")!;
    // Repositioned within the movable pass (earliest feasible from the window floor).
    expect(p.scheduledStartTime?.toISOString()).toBe(at("09:00").toISOString());
  });

  it("packs tight-deadline tasks in deadline order (EDF)", () => {
    const now = at("08:00");
    const tight = task({
      id: "tight",
      deadline: at("09:30"),
      durationMinutes: 30,
      createdAt: at("00:02"),
    });
    const loose = task({
      id: "loose",
      deadline: at("17:00"),
      durationMinutes: 30,
      createdAt: at("00:01"),
    });
    // "loose" was created earlier but has a later deadline — EDF must still
    // place "tight" first (into 09:00) since it sorts by deadline first.
    const placements = scheduleAll(prefs, [loose, tight], unscoped(now));
    const tightP = placements.find((p) => p.id === "tight")!;
    const looseP = placements.find((p) => p.id === "loose")!;
    expect(tightP.scheduledStartTime?.toISOString()).toBe(
      at("09:00").toISOString(),
    );
    expect(looseP.scheduledStartTime?.toISOString()).toBe(
      at("09:30").toISOString(),
    );
  });

  it("stable tie-break: equal deadlines resolve by createdAt ascending", () => {
    const now = at("08:00");
    const deadline = at("17:00");
    const first = task({
      id: "first",
      deadline,
      durationMinutes: 30,
      createdAt: at("00:01"),
    });
    const second = task({
      id: "second",
      deadline,
      durationMinutes: 30,
      createdAt: at("00:02"),
    });
    // Insert in reverse order — the sort must still resolve by createdAt, not
    // input order.
    const placements = scheduleAll(prefs, [second, first], unscoped(now));
    const firstP = placements.find((p) => p.id === "first")!;
    const secondP = placements.find((p) => p.id === "second")!;
    expect(firstP.scheduledStartTime?.toISOString()).toBe(
      at("09:00").toISOString(),
    );
    expect(secondP.scheduledStartTime?.toISOString()).toBe(
      at("09:30").toISOString(),
    );
  });

  it("no-deadline tasks sort after every deadline-bearing task", () => {
    const now = at("08:00");
    const noDeadline = task({
      id: "flex",
      deadline: null,
      durationMinutes: 30,
      createdAt: at("00:00"),
    });
    const deadlined = task({
      id: "hard",
      deadline: at("17:00"),
      durationMinutes: 30,
      createdAt: at("00:05"),
    });
    const placements = scheduleAll(
      prefs,
      [noDeadline, deadlined],
      unscoped(now),
    );
    const hardP = placements.find((p) => p.id === "hard")!;
    const flexP = placements.find((p) => p.id === "flex")!;
    expect(hardP.scheduledStartTime?.toISOString()).toBe(
      at("09:00").toISOString(),
    );
    expect(flexP.scheduledStartTime?.toISOString()).toBe(
      at("09:30").toISOString(),
    );
  });

  it("marks a movable task unplaceable (conflict: true, null slot) when no feasible slot exists", () => {
    const now = at("16:45");
    const t = task({ id: "a", deadline: at("17:00"), durationMinutes: 60 });
    const placements = scheduleAll(prefs, [t], unscoped(now));
    const p = placements.find((x) => x.id === "a")!;
    expect(p.scheduledStartTime).toBeNull();
    expect(p.conflict).toBe(true);
  });

  it("re-ranks the feasible set by the preference matrix, routing a movable task toward a liked (but non-earliest) slot", () => {
    const now = at("08:00");
    const t = task({ id: "a", deadline: at("17:00"), durationMinutes: 60 });
    // Monday 13:00 strongly liked; every other feasible hour neutral (0).
    const matrix = new Array<number>(PREFERENCE_MATRIX_LENGTH).fill(0);
    matrix[preferenceIndex(at("13:00"), prefs.timezone)] = 5;

    const placements = scheduleAll(prefs, [t], unscoped(now), matrix);
    const p = placements.find((x) => x.id === "a")!;

    expect(p.scheduledStartTime).not.toBeNull();
    const start = p.scheduledStartTime!;
    // Routed to the liked hour rather than the earliest feasible slot (09:00).
    expect(start.toISOString()).not.toBe(at("09:00").toISOString());
    expect(start.getUTCHours()).toBe(13);
    // Still bounded by the deadline-feasible set: never before `now`, never
    // after the last feasible start (deadline - duration).
    expect(start.getTime()).toBeGreaterThanOrEqual(now.getTime());
    expect(start.getTime() + t.durationMinutes * 60_000).toBeLessThanOrEqual(
      at("17:00").getTime(),
    );
    expect(p.propensity).toEqual(expect.any(Number));
  });

  it("with no matrix arg (default cold start), behavior is byte-identical to earliest-first", () => {
    const now = at("08:00");
    const tight = task({
      id: "tight",
      deadline: at("09:30"),
      durationMinutes: 30,
      createdAt: at("00:02"),
    });
    const loose = task({
      id: "loose",
      deadline: at("17:00"),
      durationMinutes: 30,
      createdAt: at("00:01"),
    });
    // No 4th arg — defaults to [], matching every pre-existing call site.
    const placements = scheduleAll(prefs, [loose, tight], unscoped(now));
    const tightP = placements.find((p) => p.id === "tight")!;
    const looseP = placements.find((p) => p.id === "loose")!;
    expect(tightP.scheduledStartTime?.toISOString()).toBe(
      at("09:00").toISOString(),
    );
    expect(looseP.scheduledStartTime?.toISOString()).toBe(
      at("09:30").toISOString(),
    );
  });

  it("an explicit all-zero or wrong-length matrix is also cold-start-safe (identical to earliest-first)", () => {
    const now = at("08:00");
    const t = task({ id: "a", deadline: at("17:00"), durationMinutes: 60 });

    const allZero = new Array<number>(PREFERENCE_MATRIX_LENGTH).fill(0);
    const zeroPlacements = scheduleAll(prefs, [t], unscoped(now), allZero);
    expect(
      zeroPlacements
        .find((p) => p.id === "a")!
        .scheduledStartTime?.toISOString(),
    ).toBe(at("09:00").toISOString());

    const wrongLength = [1, 2, 3];
    const wrongLengthPlacements = scheduleAll(
      prefs,
      [t],
      unscoped(now),
      wrongLength,
    );
    expect(
      wrongLengthPlacements
        .find((p) => p.id === "a")!
        .scheduledStartTime?.toISOString(),
    ).toBe(at("09:00").toISOString());
  });
});
