import { type SchedulerPrefs } from "./edf";
import { findNextAvailableSlot, findSlotIgnoringWorkHours } from "./overflow";
import { periodRange } from "./horizon";

const prefs: SchedulerPrefs = {
  workStart: 540, // 09:00
  workEnd: 1020, // 17:00
  workDays: [1, 2, 3, 4, 5], // Mon–Fri
  timezone: "UTC",
};

// 2026-06-08 Mon … 06-12 Fri; 06-13/14 weekend; 06-15 Mon.
// 2026-06-09 is a Tuesday.
const iso = (d: Date | null) => (d ? d.toISOString() : null);

/** Day/week/month [start, end) UTC bounds of the period containing `anchor`. */
const bounds = (anchor: string, view: "day" | "week" | "month") =>
  periodRange(new Date(anchor), view, prefs.timezone);

describe("findSlotIgnoringWorkHours — period-bounded off-hours slot", () => {
  it("11pm Tue (day view): offers the ~23:00 off-hours slot inside the day", () => {
    // The repro: it is 23:00 Tue, day view, period = Tue [00:00, Wed 00:00).
    // The 09:00–17:00 work window is over, but a 30-min task still fits off-hours
    // before midnight.
    const tue = bounds("2026-06-09T00:00:00Z", "day");
    const slot = findSlotIgnoringWorkHours(
      30,
      null,
      [],
      new Date("2026-06-09T23:00:00Z"),
      tue.start,
      tue.end,
    );
    expect(iso(slot)).toBe("2026-06-09T23:00:00.000Z");
  });

  it("returns null when no off-hours slot fits before the period ends", () => {
    // 23:30 Tue, a 60-min task can't end before Wed 00:00 → no off-hours room
    // left in the period.
    const tue = bounds("2026-06-09T00:00:00Z", "day");
    const slot = findSlotIgnoringWorkHours(
      60,
      null,
      [],
      new Date("2026-06-09T23:30:00Z"),
      tue.start,
      tue.end,
    );
    expect(slot).toBeNull();
  });

  it("places before the work window when now is in the small hours", () => {
    // 03:00 Tue, before the 09:00 work window. Off-hours is allowed, so the
    // earliest slot is now (03:00), well inside the day.
    const tue = bounds("2026-06-09T00:00:00Z", "day");
    const slot = findSlotIgnoringWorkHours(
      60,
      null,
      [],
      new Date("2026-06-09T03:00:00Z"),
      tue.start,
      tue.end,
    );
    expect(iso(slot)).toBe("2026-06-09T03:00:00.000Z");
  });

  it("snaps up to the next 15-min grid boundary", () => {
    const tue = bounds("2026-06-09T00:00:00Z", "day");
    const slot = findSlotIgnoringWorkHours(
      30,
      null,
      [],
      new Date("2026-06-09T09:07:00Z"),
      tue.start,
      tue.end,
    );
    expect(iso(slot)).toBe("2026-06-09T09:15:00.000Z");
  });

  it("avoids occupied intervals within the period", () => {
    const tue = bounds("2026-06-09T00:00:00Z", "day");
    const occ = [
      {
        start: Date.parse("2026-06-09T20:00:00Z"),
        end: Date.parse("2026-06-09T21:30:00Z"),
      },
    ];
    const slot = findSlotIgnoringWorkHours(
      60,
      null,
      [],
      new Date("2026-06-09T20:00:00Z"),
      tue.start,
      tue.end,
    ); // sanity (no occ): 20:00
    expect(iso(slot)).toBe("2026-06-09T20:00:00.000Z");
    const slot2 = findSlotIgnoringWorkHours(
      60,
      null,
      occ,
      new Date("2026-06-09T20:00:00Z"),
      tue.start,
      tue.end,
    );
    expect(iso(slot2)).toBe("2026-06-09T21:30:00.000Z");
  });

  it("respects a user deadline tighter than the period end", () => {
    // Deadline 21:00 Tue: a 60-min task at 20:30 would end 21:30 > deadline, so
    // the last fit is 20:00 (ends 21:00).
    const tue = bounds("2026-06-09T00:00:00Z", "day");
    const slot = findSlotIgnoringWorkHours(
      60,
      new Date("2026-06-09T21:00:00Z"),
      [],
      new Date("2026-06-09T20:00:00Z"),
      tue.start,
      tue.end,
    );
    expect(iso(slot)).toBe("2026-06-09T20:00:00.000Z");

    const tooTight = findSlotIgnoringWorkHours(
      60,
      new Date("2026-06-09T20:30:00Z"),
      [],
      new Date("2026-06-09T20:00:00Z"),
      tue.start,
      tue.end,
    );
    expect(tooTight).toBeNull();
  });

  it("week view: allows an off-hours slot later in the week", () => {
    // Period = week of Mon 06-08 … Sun 06-14. now is Tue 23:00; an off-hours
    // slot is still available that night (within the week).
    const week = bounds("2026-06-09T00:00:00Z", "week");
    const slot = findSlotIgnoringWorkHours(
      30,
      null,
      [],
      new Date("2026-06-09T23:00:00Z"),
      week.start,
      week.end,
    );
    expect(iso(slot)).toBe("2026-06-09T23:00:00.000Z");
  });
});

describe("findNextAvailableSlot — next period after the anchor period", () => {
  it("day: schedules at work start of the next working day", () => {
    // anchor Tue 06-09 → next day Wed 06-10 at 09:00.
    const slot = findNextAvailableSlot(
      prefs,
      60,
      [],
      new Date("2026-06-09T23:00:00Z"),
      new Date("2026-06-09T00:00:00Z"),
      "day",
    );
    expect(iso(slot)).toBe("2026-06-10T09:00:00.000Z");
  });

  it("day: rolls a Friday anchor over the weekend to Monday", () => {
    // anchor Fri 06-12 → next day Sat 06-13 (not a workday) → Mon 06-15 09:00.
    const slot = findNextAvailableSlot(
      prefs,
      60,
      [],
      new Date("2026-06-12T23:00:00Z"),
      new Date("2026-06-12T00:00:00Z"),
      "day",
    );
    expect(iso(slot)).toBe("2026-06-15T09:00:00.000Z");
  });

  it("week: schedules at the start of next week (Mon 06-15 09:00)", () => {
    // anchor in the week of Mon 06-08; next week starts Mon 06-15.
    const slot = findNextAvailableSlot(
      prefs,
      60,
      [],
      new Date("2026-06-09T23:00:00Z"),
      new Date("2026-06-09T00:00:00Z"),
      "week",
    );
    expect(iso(slot)).toBe("2026-06-15T09:00:00.000Z");
  });

  it("month: schedules at the first working day of next month", () => {
    // anchor in June → next month July; 2026-07-01 is a Wednesday (a work day).
    const slot = findNextAvailableSlot(
      prefs,
      60,
      [],
      new Date("2026-06-20T23:00:00Z"),
      new Date("2026-06-20T00:00:00Z"),
      "month",
    );
    expect(iso(slot)).toBe("2026-07-01T09:00:00.000Z");
  });

  it("respects occupied intervals on the target day", () => {
    const occ = [
      {
        start: Date.parse("2026-06-10T09:00:00Z"),
        end: Date.parse("2026-06-10T10:00:00Z"),
      },
    ];
    const slot = findNextAvailableSlot(
      prefs,
      60,
      occ,
      new Date("2026-06-09T23:00:00Z"),
      new Date("2026-06-09T00:00:00Z"),
      "day",
    );
    expect(iso(slot)).toBe("2026-06-10T10:00:00.000Z");
  });

  it("aligns placements to the 15-minute grid", () => {
    const slot = findNextAvailableSlot(
      prefs,
      45,
      [],
      new Date("2026-06-09T23:00:00Z"),
      new Date("2026-06-09T00:00:00Z"),
      "day",
    );
    expect(slot!.getTime() % (15 * 60_000)).toBe(0);
  });
});

describe("findNextAvailableSlot — midnight-wrap work window", () => {
  const nightPrefs: SchedulerPrefs = {
    workStart: 1320, // 22:00
    workEnd: 360, // 06:00 next day (wraps)
    workDays: [1, 2, 3, 4, 5],
    timezone: "UTC",
  };

  it("day: rolls to the NEXT night, not the anchor day's morning tail", () => {
    // anchor Mon 06-08. The Mon-night window (22:00 Mon → 06:00 Tue) BELONGS to
    // the anchor day now that the period ceiling wraps past midnight to 06:00
    // Tue — its morning tail (Tue 00:00–06:00) is offered via `outsideHours`,
    // NOT re-offered here. So "next available" starts at the anchor period's
    // extended end (Tue 06:00) and lands at the next night's start, Tue 22:00.
    const slot = findNextAvailableSlot(
      nightPrefs,
      60,
      [],
      new Date("2026-06-08T23:00:00Z"),
      new Date("2026-06-08T00:00:00Z"),
      "day",
    );
    expect(iso(slot)).toBe("2026-06-09T22:00:00.000Z");
  });
});
