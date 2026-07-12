import { PREFERENCE_MATRIX_LENGTH } from "@zenflow/shared";
import {
  deviationCost,
  deviationWeight,
  fallbackSlot,
  feasibleSlots,
  findNextAvailableSlot,
  findSlotIgnoringWorkHours,
  intervalOf,
  isPast,
  latenessCost,
  offHoursCost,
  placementCost,
  scheduleAll,
} from "./edf";
import type { EdfTask, SchedulerPrefs } from "../interfaces";
import {
  addDaysStr,
  preferenceIndex,
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

/**
 * Pure EDF core coverage (docs/heuristic.md, CLAUDE.md invariant #2). The
 * continuous cost model ({@link placementCost} et al.) is the most important
 * pure function in the codebase — see the `cost model` and `scheduleAll`
 * describe blocks below for its dedicated coverage.
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

/**
 * The continuous cost model (CLAUDE.md invariant #2 redesign): replaces the
 * old hard `manuallyMoved` freeze + hard deadline cutoff with
 * `deviationCost + latenessCost + offHoursCost − preferenceBonus`. These are
 * unit tests of the individual pure exports in isolation; `scheduleAll`'s own
 * describe block below covers the emergent end-to-end behavior.
 */
describe("cost model — deviationWeight", () => {
  const now = at("08:00");

  it("is DEVIATION_WEIGHT_NEAR at (or before) now", () => {
    expect(deviationWeight(now, now)).toBeCloseTo(DEVIATION_WEIGHT_NEAR);
    // Clamped, not extrapolated, for an anchor BEFORE now.
    expect(deviationWeight(at("07:00"), now)).toBeCloseTo(
      DEVIATION_WEIGHT_NEAR,
    );
  });

  it("is DEVIATION_WEIGHT_FAR at/beyond DEVIATION_HORIZON_DAYS out", () => {
    const anchor = new Date(
      now.getTime() + DEVIATION_HORIZON_DAYS * 24 * 60 * 60 * 1000,
    );
    expect(deviationWeight(anchor, now)).toBeCloseTo(DEVIATION_WEIGHT_FAR);
    // Even further out never goes below the floor.
    const anchorFarther = new Date(anchor.getTime() + 10 * 24 * 60 * 60 * 1000);
    expect(deviationWeight(anchorFarther, now)).toBeCloseTo(
      DEVIATION_WEIGHT_FAR,
    );
  });

  it("linearly interpolates in between", () => {
    const halfHorizon = new Date(
      now.getTime() + (DEVIATION_HORIZON_DAYS / 2) * 24 * 60 * 60 * 1000,
    );
    const expected = (DEVIATION_WEIGHT_NEAR + DEVIATION_WEIGHT_FAR) / 2;
    expect(deviationWeight(halfHorizon, now)).toBeCloseTo(expected);
  });
});

describe("cost model — deviationCost", () => {
  const now = at("08:00");

  it("is zero for a task with no anchor, for any candidate", () => {
    expect(deviationCost(null, at("09:00").getTime(), now)).toBe(0);
    expect(deviationCost(null, at("16:00").getTime(), now)).toBe(0);
  });

  it("is zero when the candidate equals the anchor", () => {
    const anchor = at("09:00");
    expect(deviationCost(anchor, anchor.getTime(), now)).toBe(0);
  });

  it("scales with |candidate - anchor| in minutes, weighted by deviationWeight", () => {
    const anchor = at("09:00"); // 1 hour from now: near-term, weight ≈ 1.0
    const cost = deviationCost(anchor, at("10:00").getTime(), now);
    expect(cost).toBeCloseTo(60 * deviationWeight(anchor, now));
  });

  it("costs 10x less per minute for a far-future anchor than a near one", () => {
    const nearAnchor = now; // exactly at now: weight === DEVIATION_WEIGHT_NEAR
    const farAnchor = new Date(
      now.getTime() + (DEVIATION_HORIZON_DAYS + 1) * 24 * 60 * 60 * 1000,
    );
    const nearCost = deviationCost(
      nearAnchor,
      nearAnchor.getTime() + 60 * 60_000,
      now,
    );
    const farCost = deviationCost(
      farAnchor,
      farAnchor.getTime() + 60 * 60_000,
      now,
    );
    expect(nearCost).toBeCloseTo(60 * DEVIATION_WEIGHT_NEAR, 5);
    expect(farCost).toBeCloseTo(60 * DEVIATION_WEIGHT_FAR, 5);
    expect(farCost).toBeLessThan(nearCost);
  });
});

describe("cost model — latenessCost", () => {
  it("is zero with no deadline", () => {
    expect(latenessCost(at("10:00").getTime(), null)).toBe(0);
  });

  it("is zero when the candidate ends at/before the deadline", () => {
    expect(latenessCost(at("09:00").getTime(), at("09:00"))).toBe(0);
    expect(latenessCost(at("08:00").getTime(), at("09:00"))).toBe(0);
  });

  it("is LATENESS_RATE per minute past the deadline", () => {
    const deadline = at("09:00");
    const candidateEnd = at("09:30").getTime();
    expect(latenessCost(candidateEnd, deadline)).toBe(30 * LATENESS_RATE);
  });
});

describe("cost model — offHoursCost", () => {
  it("is zero for a candidate entirely inside work hours", () => {
    const candidate: Interval = {
      start: at("10:00").getTime(),
      end: at("11:00").getTime(),
    };
    expect(offHoursCost(candidate, prefs)).toBe(0);
  });

  it("is HOURS_RATE per minute for a candidate entirely outside work hours", () => {
    const candidate: Interval = {
      start: at("02:00").getTime(),
      end: at("03:00").getTime(),
    };
    expect(offHoursCost(candidate, prefs)).toBe(60 * HOURS_RATE);
  });

  it("prorates a candidate straddling the work window boundary", () => {
    // 08:30–09:30 — 30 min before work starts (09:00), 30 min inside it.
    const candidate: Interval = {
      start: at("08:30").getTime(),
      end: at("09:30").getTime(),
    };
    expect(offHoursCost(candidate, prefs)).toBe(30 * HOURS_RATE);
  });
});

describe("cost model — placementCost (the combining function)", () => {
  const now = at("08:00");

  it("sums deviation + lateness + offHours and subtracts the preference bonus", () => {
    const t = task({
      id: "a",
      scheduledStartTime: at("09:00"),
      deadline: at("09:30"),
      durationMinutes: 60,
    });
    const candidate: Interval = {
      start: at("10:00").getTime(), // 1h from anchor
      end: at("11:00").getTime(), // 90 min past the 09:30 deadline
    };
    const matrix = new Array<number>(PREFERENCE_MATRIX_LENGTH).fill(0);
    matrix[preferenceIndex(at("10:00"), prefs.timezone)] = 3; // liked slot

    const expected =
      deviationCost(t.scheduledStartTime, candidate.start, now) +
      latenessCost(candidate.end, t.deadline) +
      offHoursCost(candidate, prefs) -
      3;
    expect(placementCost(t, candidate, now, prefs, matrix)).toBeCloseTo(
      expected,
    );
  });

  it("is exactly zero for an unanchored, no-deadline, in-hours, neutral-preference candidate", () => {
    const t = task({ id: "a", scheduledStartTime: null, deadline: null });
    const candidate: Interval = {
      start: at("10:00").getTime(),
      end: at("11:00").getTime(),
    };
    expect(placementCost(t, candidate, now, prefs, [])).toBe(0);
  });
});

describe("scheduleAll", () => {
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
    const placements = scheduleAll(prefs, [loose, tight], now);
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
    const placements = scheduleAll(prefs, [second, first], now);
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
    const placements = scheduleAll(prefs, [noDeadline, deadlined], now);
    const hardP = placements.find((p) => p.id === "hard")!;
    const flexP = placements.find((p) => p.id === "flex")!;
    expect(hardP.scheduledStartTime?.toISOString()).toBe(
      at("09:00").toISOString(),
    );
    expect(flexP.scheduledStartTime?.toISOString()).toBe(
      at("09:30").toISOString(),
    );
  });

  it("re-ranks the feasible set by the preference matrix, routing a movable task toward a liked (but non-earliest) slot", () => {
    const now = at("08:00");
    const t = task({ id: "a", deadline: at("17:00"), durationMinutes: 60 });
    // Monday 13:00 strongly liked; every other feasible hour neutral (0).
    const matrix = new Array<number>(PREFERENCE_MATRIX_LENGTH).fill(0);
    matrix[preferenceIndex(at("13:00"), prefs.timezone)] = 5;

    const placements = scheduleAll(prefs, [t], now, matrix);
    const p = placements.find((x) => x.id === "a")!;

    expect(p.scheduledStartTime).not.toBeNull();
    const start = p.scheduledStartTime!;
    // Routed to the liked hour rather than the earliest feasible slot (09:00).
    expect(start.toISOString()).not.toBe(at("09:00").toISOString());
    expect(start.getUTCHours()).toBe(13);
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
    const placements = scheduleAll(prefs, [loose, tight], now);
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
    const zeroPlacements = scheduleAll(prefs, [t], now, allZero);
    expect(
      zeroPlacements
        .find((p) => p.id === "a")!
        .scheduledStartTime?.toISOString(),
    ).toBe(at("09:00").toISOString());

    const wrongLength = [1, 2, 3];
    const wrongLengthPlacements = scheduleAll(prefs, [t], now, wrongLength);
    expect(
      wrongLengthPlacements
        .find((p) => p.id === "a")!
        .scheduledStartTime?.toISOString(),
    ).toBe(at("09:00").toISOString());
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
    const placements = scheduleAll(prefs, [past, movable], now);

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

  it("only comes back conflict: true, null slot when every candidate source is exhausted (a genuinely saturated horizon)", () => {
    const now = at("08:00");
    const t = task({ id: "a", deadline: at("17:00"), durationMinutes: 60 });

    // One no-deadline, full-calendar-day "wall" task per day across the
    // whole scan horizon — each is trivially cost-stable at its own anchor
    // (deviationCost is the floor, 0, only there), so `scheduleAll` leaves
    // every one of them exactly in place, genuinely saturating every day "a"
    // could otherwise land on (in-hours, out-of-hours, or past-deadline).
    let d = DAY;
    const walls: EdfTask[] = [];
    for (let i = 0; i <= MAX_SCAN_DAYS + 1; i++) {
      walls.push(
        task({
          id: `wall-${i}`,
          scheduledStartTime: new Date(`${d}T00:00:00.000Z`),
          durationMinutes: 24 * 60,
          createdAt: at("00:00", i),
        }),
      );
      d = addDaysStr(d, 1);
    }

    const placements = scheduleAll(prefs, [t, ...walls], now);
    const p = placements.find((x) => x.id === "a")!;
    expect(p.scheduledStartTime).toBeNull();
    expect(p.conflict).toBe(true);
  });

  describe("stability — reoptimizing an already-good schedule is a no-op", () => {
    it("keeps every already-well-placed task exactly where it is", () => {
      const now = at("08:00");
      const a = task({
        id: "a",
        manuallyMoved: true, // an earlier real drag — must stay true if untouched
        scheduledStartTime: at("09:00"),
        deadline: at("17:00"),
        durationMinutes: 60,
      });
      const b = task({
        id: "b",
        scheduledStartTime: at("10:00"),
        deadline: at("17:00", 1),
        durationMinutes: 60,
        createdAt: at("00:01"),
      });
      const c = task({
        id: "c",
        scheduledStartTime: at("11:00"),
        deadline: null,
        durationMinutes: 30,
        createdAt: at("00:02"),
      });
      const placements = scheduleAll(prefs, [a, b, c], now);

      for (const [id, expected] of [
        ["a", at("09:00")],
        ["b", at("10:00")],
        ["c", at("11:00")],
      ] as const) {
        const p = placements.find((x) => x.id === id)!;
        expect(p.scheduledStartTime?.toISOString()).toBe(
          expected.toISOString(),
        );
        expect(p.conflict).toBe(false);
      }
      // The manual pin survives an untouched pass; an untouched auto
      // placement stays unpinned.
      expect(placements.find((p) => p.id === "a")!.manuallyMoved).toBe(true);
      expect(placements.find((p) => p.id === "b")!.manuallyMoved).toBe(false);
    });
  });

  describe("near-term protection", () => {
    // A 1-hour workday (09:00-10:00) makes "the only same-day slot" trivial
    // to reason about: if a near-anchored task gets evicted from it, its
    // cheapest same-day alternative is off-hours (never another in-hours
    // slot), so relocating it is comparatively expensive — the algorithm
    // should prefer leaving it alone.
    const shortDayPrefs: SchedulerPrefs = {
      ...prefs,
      workStart: 540, // 09:00
      workEnd: 600, // 10:00
    };

    it("does not bump a near-anchored task even when a more urgent task wants its exact slot — the urgent task settles for its own next-best instead", () => {
      const now = at("08:00");
      const nearTask = task({
        id: "near",
        scheduledStartTime: at("09:00"), // 1 hour from now
        deadline: null,
        durationMinutes: 60,
      });
      const urgentTask = task({
        id: "urgent",
        scheduledStartTime: null,
        deadline: at("10:00"), // forces exactly the 09:00-10:00 slot
        durationMinutes: 60,
        createdAt: at("00:01"),
      });

      const placements = scheduleAll(
        shortDayPrefs,
        [nearTask, urgentTask],
        now,
      );

      const nearP = placements.find((p) => p.id === "near")!;
      const urgentP = placements.find((p) => p.id === "urgent")!;

      // The near-term task is fully protected — it never moves.
      expect(nearP.scheduledStartTime?.toISOString()).toBe(
        at("09:00").toISOString(),
      );
      expect(nearP.conflict).toBe(false);
      // The urgent task settles for its own next-best (an off-hours slot
      // just before the work day) rather than displacing it.
      expect(urgentP.scheduledStartTime?.toISOString()).toBe(
        at("08:00").toISOString(),
      );
      expect(urgentP.conflict).toBe(false);
    });
  });

  describe("far-term negotiability", () => {
    it("a task anchored beyond DEVIATION_HORIZON_DAYS moves readily to make room, when doing so is cost-favorable", () => {
      const now = at("08:00"); // Monday
      // Block every workday strictly between now and the far task's own day
      // (offsets 1..9; weekend offsets 5/6 need no wall — feasibleSlots
      // already skips non-work days) with tight-deadline "wall" tasks, so an
      // unplaced urgent task's earliest-feasible-slot search can't just grab
      // an early, unrelated day — it has to reach all the way to the far
      // task's own day (+10) to find room. Day 0 (today) is also blocked so
      // the urgent task can't grab a same-day slot ahead of "now" either.
      const walls: EdfTask[] = [0, 1, 2, 3, 4, 7, 8, 9].map((offset) =>
        task({
          id: `wall-${offset}`,
          deadline: at("17:00", offset),
          durationMinutes: 480,
          createdAt: at("00:00", offset),
        }),
      );
      const farTask = task({
        id: "far",
        scheduledStartTime: at("09:00", 10), // 10 days out — beyond the horizon
        deadline: null,
        durationMinutes: 60,
      });
      const urgentTask = task({
        id: "urgent",
        scheduledStartTime: null,
        deadline: at("10:00", 10), // forces exactly the far task's slot
        durationMinutes: 60,
        createdAt: at("00:04"),
      });

      const placements = scheduleAll(
        prefs,
        [...walls, farTask, urgentTask],
        now,
      );

      const farP = placements.find((p) => p.id === "far")!;
      const urgentP = placements.find((p) => p.id === "urgent")!;

      // The urgent task gets the slot it needed...
      expect(urgentP.scheduledStartTime?.toISOString()).toBe(
        at("09:00", 10).toISOString(),
      );
      // ...and the far-anchored task readily gives it up — a small, cheap
      // (low-weight) nudge, not a refusal.
      expect(farP.scheduledStartTime?.toISOString()).not.toBe(
        at("09:00", 10).toISOString(),
      );
      expect(farP.conflict).toBe(false);
      expect(farP.manuallyMoved).toBe(false);
    });
  });

  describe("the original bug, both directions — deadline vs. own anchor", () => {
    // A far-future anchor (low deviation weight) isolates the effect: moving
    // it is always cheap, so whichever direction the test moves is driven
    // purely by whether the deadline forces it, not by deviation dominating.
    const anchor = at("14:00", 10); // Thursday, +10 days — far-term
    const anchoredTask = (deadline: Date) =>
      task({
        id: "a",
        scheduledStartTime: anchor,
        deadline,
        durationMinutes: 60,
      });

    it("tightening the deadline past the current anchor forces relocation to a slot that respects it", () => {
      const now = at("08:00");
      const t = anchoredTask(at("13:00", 10)); // before the anchor's own start
      const placements = scheduleAll(prefs, [t], now);
      const p = placements.find((x) => x.id === "a")!;

      expect(p.scheduledStartTime).not.toBeNull();
      const start = p.scheduledStartTime!;
      // Actually moved off the stale anchor...
      expect(start.toISOString()).not.toBe(anchor.toISOString());
      // ...to a slot that respects the NEW deadline.
      expect(start.getTime() + t.durationMinutes * 60_000).toBeLessThanOrEqual(
        t.deadline!.getTime(),
      );
      // The nearest respecting slot, given the workday ends at the deadline:
      // 12:00–13:00 (2h from the 14:00 anchor — cheapest available).
      expect(start.toISOString()).toBe(at("12:00", 10).toISOString());
    });

    it("loosening the deadline does NOT force any movement", () => {
      const now = at("08:00");
      // Original deadline exactly satisfied by the anchor (ends at 15:00);
      // loosen it generously — nothing about the anchor's own cost changes.
      const t = anchoredTask(at("20:00", 10));
      const placements = scheduleAll(prefs, [t], now);
      const p = placements.find((x) => x.id === "a")!;
      expect(p.scheduledStartTime?.toISOString()).toBe(anchor.toISOString());
    });
  });

  describe("bounded eviction", () => {
    it("evicts a lower-priority occupant exactly once when cost-favorable, without cascading to a second task", () => {
      const now = at("08:00");
      const b = task({
        id: "b",
        manuallyMoved: true,
        scheduledStartTime: at("09:00"),
        deadline: null,
        durationMinutes: 60,
        createdAt: at("00:01"),
      });
      const c = task({
        id: "c",
        scheduledStartTime: at("11:00"),
        deadline: null,
        durationMinutes: 60,
        createdAt: at("00:02"),
      });
      const a = task({
        id: "a",
        scheduledStartTime: null,
        deadline: at("10:00"), // forces exactly b's slot
        durationMinutes: 60,
        createdAt: at("00:03"),
      });
      // Make the incoming task's own off-hours fallback (08:00-09:00)
      // artificially unattractive so evicting "b" (into the free 10:00-11:00
      // gap right next to "c") is the cheaper choice.
      const matrix = new Array<number>(PREFERENCE_MATRIX_LENGTH).fill(0);
      matrix[preferenceIndex(at("08:00"), prefs.timezone)] = -100;

      const placements = scheduleAll(prefs, [b, c, a], now, matrix);

      const aP = placements.find((p) => p.id === "a")!;
      const bP = placements.find((p) => p.id === "b")!;
      const cP = placements.find((p) => p.id === "c")!;

      // "a" claims the contested slot.
      expect(aP.scheduledStartTime?.toISOString()).toBe(
        at("09:00").toISOString(),
      );
      // "b" is evicted into the adjacent free gap — its pin clears once
      // actually relocated.
      expect(bP.scheduledStartTime?.toISOString()).toBe(
        at("10:00").toISOString(),
      );
      expect(bP.manuallyMoved).toBe(false);
      // "c" is completely untouched — the bound: evicting "b" never cascades
      // into evicting "c" too, even though "b" landed right next to it.
      expect(cP.scheduledStartTime?.toISOString()).toBe(
        at("11:00").toISOString(),
      );
      expect(cP.conflict).toBe(false);
    });
  });

  describe("LATENESS_RATE > HOURS_RATE ordering (emergent, not a hard tier)", () => {
    it("still prefers an off-hours-before-deadline slot over an on-time-in-hours-but-past-deadline one, when both are available", () => {
      expect(LATENESS_RATE).toBeGreaterThan(HOURS_RATE);

      const now = at("08:00");
      const t = task({
        id: "a",
        scheduledStartTime: null,
        deadline: at("09:15"), // too tight for any in-hours slot
        durationMinutes: 60,
      });
      const placements = scheduleAll(prefs, [t], now);
      const p = placements.find((x) => x.id === "a")!;
      // Off-hours-but-on-time (08:00–09:00, cost = HOURS_RATE*60) beats
      // in-hours-but-late (09:15–10:15, cost = LATENESS_RATE*60).
      expect(p.scheduledStartTime?.toISOString()).toBe(
        at("08:00").toISOString(),
      );
    });
  });

  describe("determinism", () => {
    it("the same inputs (including the seeded reranker) always produce the same output", () => {
      const now = at("08:00");
      const tasks = [
        task({
          id: "a",
          scheduledStartTime: at("09:00"),
          deadline: at("17:00"),
          durationMinutes: 60,
        }),
        task({
          id: "b",
          scheduledStartTime: null,
          deadline: at("17:00"),
          durationMinutes: 60,
          createdAt: at("00:01"),
        }),
      ];
      const matrix = new Array<number>(PREFERENCE_MATRIX_LENGTH).fill(0);
      matrix[preferenceIndex(at("13:00"), prefs.timezone)] = 5;

      const run = () =>
        scheduleAll(
          prefs,
          tasks.map((t) => ({ ...t })),
          new Date(now.getTime()),
          matrix,
        );

      const first = run();
      const second = run();
      expect(second).toEqual(first);
    });
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

/**
 * `fallbackSlot` — used directly by `SchedulerService.simulate()`'s
 * not-yet-created draft-task preview (which has no anchor, so it doesn't need
 * `scheduleAll`'s full cost-scored candidate pool — see `edf.ts`'s doc
 * comment on `fallbackSlot`).
 */
describe("fallbackSlot — outside-hours-before-deadline → in-hours-past-deadline", () => {
  it("finds an outside-hours slot that still respects the deadline", () => {
    const now = at("08:45");
    // Only 15 minutes until the deadline inside work hours, but the deadline
    // itself is far enough out (20:00) that an outside-hours slot fits.
    const t = task({ id: "a", durationMinutes: 60, deadline: at("20:00") });
    const slot = fallbackSlot(t, now, [], prefs)!;
    expect(slot).not.toBeNull();
    expect(slot.end).toBeLessThanOrEqual(t.deadline!.getTime());
  });

  it("drops the deadline entirely once the outside-hours search also fails", () => {
    const now = at("16:45");
    const t = task({ id: "a", durationMinutes: 60, deadline: at("17:00") });
    const slot = fallbackSlot(t, now, [], prefs)!;
    expect(slot).not.toBeNull();
    // Past the (now-irrelevant) deadline — the "deadline actually missed" case.
    expect(new Date(slot.start).getTime()).toBeGreaterThan(
      t.deadline!.getTime(),
    );
  });

  it("returns null only once both searches are exhausted", () => {
    const now = at("08:00");
    const t = task({ id: "a", durationMinutes: 60, deadline: at("17:00") });
    const occupied: Interval[] = [];
    let d = DAY;
    for (let i = 0; i <= MAX_SCAN_DAYS + 1; i++) {
      occupied.push({
        start: new Date(`${d}T00:00:00.000Z`).getTime(),
        end: new Date(`${addDaysStr(d, 1)}T00:00:00.000Z`).getTime(),
      });
      d = addDaysStr(d, 1);
    }
    expect(fallbackSlot(t, now, occupied, prefs)).toBeNull();
  });
});
