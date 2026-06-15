import { type SchedulerPrefs } from "./edf";
import { findNextAvailableSlot, findSlotIgnoringWorkHours } from "./overflow";

const prefs: SchedulerPrefs = {
  workStart: 540, // 09:00
  workEnd: 1020, // 17:00
  workDays: [1, 2, 3, 4, 5], // Mon–Fri
  timezone: "UTC",
};

// 2026-06-08 Mon … 06-12 Fri; 06-13/14 weekend; 06-15 Mon.
const MON_9AM = new Date("2026-06-08T09:00:00Z");

const iso = (d: Date | null) => (d ? d.toISOString() : null);

describe("findSlotIgnoringWorkHours", () => {
  it("returns the next 15-min grid slot from now when nothing is occupied", () => {
    const slot = findSlotIgnoringWorkHours(
      60,
      new Date("2026-06-08T20:00:00Z"),
      [],
      MON_9AM,
    );
    expect(iso(slot)).toBe("2026-06-08T09:00:00.000Z");
  });

  it("snaps up to the next 15-min grid boundary", () => {
    const slot = findSlotIgnoringWorkHours(
      30,
      new Date("2026-06-08T12:00:00Z"),
      [],
      new Date("2026-06-08T09:07:00Z"),
    );
    expect(iso(slot)).toBe("2026-06-08T09:15:00.000Z");
  });

  it("places OUTSIDE working hours (before 09:00 / after 17:00)", () => {
    // now is 03:00 — well before the 09:00 work window; off-hours is allowed.
    const slot = findSlotIgnoringWorkHours(
      60,
      new Date("2026-06-08T09:00:00Z"),
      [],
      new Date("2026-06-08T03:00:00Z"),
    );
    expect(iso(slot)).toBe("2026-06-08T03:00:00.000Z");
  });

  it("avoids occupied intervals", () => {
    const occ = [
      {
        start: Date.parse("2026-06-08T09:00:00Z"),
        end: Date.parse("2026-06-08T10:30:00Z"),
      },
    ];
    const slot = findSlotIgnoringWorkHours(
      60,
      new Date("2026-06-08T20:00:00Z"),
      occ,
      MON_9AM,
    );
    expect(iso(slot)).toBe("2026-06-08T10:30:00.000Z");
  });

  it("returns null when the deadline is too tight even off-hours", () => {
    const slot = findSlotIgnoringWorkHours(
      60,
      new Date("2026-06-08T09:30:00Z"), // only 30 min before deadline
      [],
      MON_9AM,
    );
    expect(slot).toBeNull();
  });

  it("returns null when every gap before the deadline is occupied", () => {
    const occ = [
      {
        start: Date.parse("2026-06-08T09:00:00Z"),
        end: Date.parse("2026-06-08T11:00:00Z"),
      },
    ];
    const slot = findSlotIgnoringWorkHours(
      60,
      new Date("2026-06-08T11:30:00Z"),
      occ,
      MON_9AM,
    );
    expect(slot).toBeNull();
  });
});

describe("findNextAvailableSlot", () => {
  it("day: schedules at work start of the next working day", () => {
    // now Monday 09:00 → next working day is Tuesday 06-09 at 09:00.
    const slot = findNextAvailableSlot(prefs, 60, [], MON_9AM, "day");
    expect(iso(slot)).toBe("2026-06-09T09:00:00.000Z");
  });

  it("day: rolls a Friday over the weekend to Monday", () => {
    const fri = new Date("2026-06-12T09:00:00Z");
    const slot = findNextAvailableSlot(prefs, 60, [], fri, "day");
    expect(iso(slot)).toBe("2026-06-15T09:00:00.000Z");
  });

  it("week: schedules at the start of next week (Mon 06-15 09:00)", () => {
    // now is Mon 06-08; next week starts Mon 06-15.
    const slot = findNextAvailableSlot(prefs, 60, [], MON_9AM, "week");
    expect(iso(slot)).toBe("2026-06-15T09:00:00.000Z");
  });

  it("month: schedules at the first working day of next month", () => {
    // June → July; 2026-07-01 is a Wednesday (a work day).
    const slot = findNextAvailableSlot(prefs, 60, [], MON_9AM, "month");
    expect(iso(slot)).toBe("2026-07-01T09:00:00.000Z");
  });

  it("ignores the deadline entirely (places even past a passed deadline)", () => {
    // No deadline param exists here by design; the boundary still lands a slot.
    const slot = findNextAvailableSlot(prefs, 60, [], MON_9AM, "day");
    expect(slot).not.toBeNull();
  });

  it("respects occupied intervals on the target day", () => {
    const occ = [
      {
        start: Date.parse("2026-06-09T09:00:00Z"),
        end: Date.parse("2026-06-09T10:00:00Z"),
      },
    ];
    const slot = findNextAvailableSlot(prefs, 60, occ, MON_9AM, "day");
    expect(iso(slot)).toBe("2026-06-09T10:00:00.000Z");
  });

  it("aligns placements to the 15-minute grid", () => {
    const slot = findNextAvailableSlot(prefs, 45, [], MON_9AM, "day");
    const ms = slot!.getTime();
    expect(ms % (15 * 60_000)).toBe(0);
  });
});

describe("findSlotIgnoringWorkHours — midnight-wrap is irrelevant (no work window)", () => {
  it("places in the small hours regardless of a wrapping work window", () => {
    // Off-hours scheduling does not consult workStart/workEnd at all, so a
    // wrapping window has no effect here — the first free grid slot from now.
    const slot = findSlotIgnoringWorkHours(
      30,
      new Date("2026-06-08T06:00:00Z"),
      [],
      new Date("2026-06-08T01:00:00Z"),
    );
    expect(iso(slot)).toBe("2026-06-08T01:00:00.000Z");
  });
});

describe("findNextAvailableSlot — midnight-wrap work window", () => {
  const nightPrefs: SchedulerPrefs = {
    workStart: 1320, // 22:00
    workEnd: 360, // 06:00 next day (wraps)
    workDays: [1, 2, 3, 4, 5],
    timezone: "UTC",
  };

  it("day: places inside the wrapping night window of the next working day", () => {
    // now Mon 06-08 23:00; next working day boundary is Tue 06-09 00:00.
    // The window for Tue starts 22:00 Tue; but the Mon-night window (started
    // 22:00 Mon) spills into Tue 00:00–06:00, so the earliest slot on/after the
    // Tue boundary is Tue 00:00 (the morning tail of Monday's window).
    const now = new Date("2026-06-08T23:00:00Z");
    const slot = findNextAvailableSlot(nightPrefs, 60, [], now, "day");
    expect(iso(slot)).toBe("2026-06-09T00:00:00.000Z");
  });
});
