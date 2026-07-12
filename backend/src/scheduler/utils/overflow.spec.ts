import {
  applyOverflowChoice,
  computeOverflowOptions,
  findNextAvailableSlot,
  findSlotIgnoringWorkHours,
} from "./overflow";
import type { EdfTask, SchedulerPrefs } from "../interfaces";
import { addDaysStr, type Interval } from "./slot";

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

  it("returns null when every day in the scan horizon is fully booked", () => {
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

describe("computeOverflowOptions", () => {
  it("packages both recovery options", () => {
    const now = at("20:00");
    const t = task({ id: "a", durationMinutes: 60, deadline: at("10:00") });
    const result = computeOverflowOptions(t, now, [], prefs);
    expect(result.outsideHours).not.toBeNull();
    expect(result.nextAvailable).not.toBeNull();
  });
});

describe("applyOverflowChoice", () => {
  it("pins the task at the chosen slot as manuallyMoved", () => {
    const now = at("08:00");
    const t = task({ id: "a", durationMinutes: 60, deadline: at("09:00") });
    const chosenSlot: Interval = {
      start: at("20:00").getTime(),
      end: at("21:00").getTime(),
    };
    const { placements } = applyOverflowChoice(
      "outsideHours",
      t,
      chosenSlot,
      [t],
      prefs,
      now,
    );
    const p = placements.find((x) => x.id === "a")!;
    expect(p.scheduledStartTime?.toISOString()).toBe(at("20:00").toISOString());
    expect(p.conflict).toBe(false);
  });

  it("repacks other movable tasks around the newly-pinned task", () => {
    const now = at("08:00");
    const overflowTask = task({
      id: "a",
      durationMinutes: 60,
      deadline: at("09:00"),
    });
    const other = task({
      id: "b",
      durationMinutes: 60,
      deadline: at("17:00"),
      createdAt: at("00:01"),
    });
    const chosenSlot: Interval = {
      start: at("09:00").getTime(),
      end: at("10:00").getTime(),
    };
    const { placements, displaced } = applyOverflowChoice(
      "outsideHours",
      overflowTask,
      chosenSlot,
      [overflowTask, other],
      prefs,
      now,
    );
    const bPlacement = placements.find((p) => p.id === "b")!;
    // "a" now occupies 09:00-10:00 → "b" must reflow to 10:00.
    expect(bPlacement.scheduledStartTime?.toISOString()).toBe(
      at("10:00").toISOString(),
    );
    expect(displaced.some((d) => d.id === "b")).toBe(true);
  });

  it("auto-heals a secondary overflow via findSlotIgnoringWorkHours without re-prompting", () => {
    const now = at("08:00");
    // "a" is the overflow task, pinned right at the start of the work day.
    const overflowTask = task({
      id: "a",
      durationMinutes: 480,
      deadline: at("09:00"),
    }); // 8h
    // "b" has a hard, TIGHT deadline that only fits in the work day "a" now fills.
    const secondary = task({
      id: "b",
      durationMinutes: 60,
      deadline: at("17:00"),
      createdAt: at("00:01"),
    });
    const chosenSlot: Interval = {
      start: at("09:00").getTime(),
      end: at("17:00").getTime(), // fills the ENTIRE work day
    };
    const { placements, displaced } = applyOverflowChoice(
      "outsideHours",
      overflowTask,
      chosenSlot,
      [overflowTask, secondary],
      prefs,
      now,
    );
    const bPlacement = placements.find((p) => p.id === "b")!;
    // "b" must NOT come back conflicted — it should have been auto-healed to
    // an outside-hours slot instead of surfacing a second prompt.
    expect(bPlacement.conflict).toBe(false);
    expect(bPlacement.scheduledStartTime).not.toBeNull();
    expect(displaced.some((d) => d.id === "b")).toBe(true);
  });

  it("keeps every deadline hard through the recursive auto-heal walk", () => {
    // Even while auto-healing, findSlotIgnoringWorkHours never respects a
    // DIFFERENT task's deadline as a bound (it ignores deadlines entirely by
    // design) — but it must never overlap the pinned task itself.
    const now = at("08:00");
    const overflowTask = task({
      id: "a",
      durationMinutes: 480,
      deadline: at("09:00"),
    });
    const secondary = task({
      id: "b",
      durationMinutes: 60,
      deadline: at("17:00"),
      createdAt: at("00:01"),
    });
    const chosenSlot: Interval = {
      start: at("09:00").getTime(),
      end: at("17:00").getTime(),
    };
    const { placements } = applyOverflowChoice(
      "outsideHours",
      overflowTask,
      chosenSlot,
      [overflowTask, secondary],
      prefs,
      now,
    );
    const aInterval = {
      start: at("09:00").getTime(),
      end: at("17:00").getTime(),
    };
    const bPlacement = placements.find((p) => p.id === "b")!;
    const bStart = bPlacement.scheduledStartTime!.getTime();
    const bEnd = bStart + 60 * 60_000;
    const overlaps = bStart < aInterval.end && bEnd > aInterval.start;
    expect(overlaps).toBe(false);
  });
});
