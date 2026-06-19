import {
  compareEdf,
  type EdfTask,
  feasibleSlots,
  findSlot,
  hasElapsed,
  isPast,
  scheduleAll,
  type SchedulerPrefs,
} from "./edf";
import { endOfPeriod } from "./horizon";

const prefs: SchedulerPrefs = {
  workStart: 540, // 09:00
  workEnd: 1020, // 17:00
  workDays: [1, 2, 3, 4, 5], // Mon–Fri
  timezone: "UTC",
};

// 2026-06-08 is a Monday; 06-12 Friday; 06-13/14 weekend; 06-15 Monday.
const MON_MIDNIGHT = new Date("2026-06-08T00:00:00Z");

const task = (over: Partial<EdfTask> & Pick<EdfTask, "id">): EdfTask => ({
  durationMinutes: 60,
  deadline: null,
  fixed: false,
  manuallyMoved: false,
  schedulingAnchor: null,
  scheduledStartTime: null,
  createdAt: MON_MIDNIGHT,
  conflict: false,
  ...over,
});

const iso = (d: Date | null) => (d ? d.toISOString() : null);

describe("findSlot", () => {
  it("places at work start on an empty day", () => {
    const slot = findSlot(prefs, 60, null, [], MON_MIDNIGHT);
    expect(iso(slot)).toBe("2026-06-08T09:00:00.000Z");
  });

  it("clamps to now and snaps up to the next 15-min slot", () => {
    const slot = findSlot(
      prefs,
      60,
      null,
      [],
      new Date("2026-06-08T09:40:00Z"),
    );
    expect(iso(slot)).toBe("2026-06-08T09:45:00.000Z");
  });

  it("skips occupied intervals", () => {
    const occ = [
      {
        start: Date.parse("2026-06-08T09:00:00Z"),
        end: Date.parse("2026-06-08T10:00:00Z"),
      },
    ];
    const slot = findSlot(prefs, 60, null, occ, MON_MIDNIGHT);
    expect(iso(slot)).toBe("2026-06-08T10:00:00.000Z");
  });

  it("returns null (conflict) when the deadline cannot be met", () => {
    const slot = findSlot(
      prefs,
      60,
      new Date("2026-06-08T09:30:00Z"),
      [],
      MON_MIDNIGHT,
    );
    expect(slot).toBeNull();
  });

  it("rolls over the weekend to the next work day", () => {
    const slot = findSlot(
      prefs,
      60,
      null,
      [],
      new Date("2026-06-12T16:30:00Z"),
    );
    expect(iso(slot)).toBe("2026-06-15T09:00:00.000Z");
  });

  it("skips a non-working day and rolls forward to the next workday", () => {
    // 2026-06-13 is a Saturday; earliest pins the search to it, but the
    // workday-only behaviour rolls forward to Monday 06-15.
    const slot = findSlot(
      prefs,
      60,
      null,
      [],
      MON_MIDNIGHT,
      new Date("2026-06-13T00:00:00Z"), // Saturday
    );
    expect(iso(slot)).toBe("2026-06-15T09:00:00.000Z");
  });
});

describe("feasibleSlots", () => {
  it("enumerates EVERY grid slot of an empty work day in ascending order", () => {
    // Bound to a single day via an end-of-day deadline. 09:00–17:00, 60-min
    // task: starts fit at 09:00,09:15,…,16:00 → 29 slots.
    const slots = feasibleSlots(
      prefs,
      60,
      new Date("2026-06-08T17:00:00Z"),
      [],
      MON_MIDNIGHT,
    );
    expect(slots).toHaveLength(29);
    expect(iso(slots[0])).toBe("2026-06-08T09:00:00.000Z");
    expect(iso(slots[1])).toBe("2026-06-08T09:15:00.000Z");
    expect(iso(slots[slots.length - 1])).toBe("2026-06-08T16:00:00.000Z");
    // Strictly ascending.
    for (let i = 1; i < slots.length; i++) {
      expect(slots[i].getTime()).toBeGreaterThan(slots[i - 1].getTime());
    }
  });

  it("drops slots overlapping an occupied interval but keeps the rest", () => {
    // 09:00–10:00 busy: the slots starting 09:00…09:45 (which would overlap it)
    // are excluded; the next feasible start is 10:00. Bounded to one day by an
    // end-of-day deadline so the count is deterministic.
    const occ = [
      {
        start: Date.parse("2026-06-08T09:00:00Z"),
        end: Date.parse("2026-06-08T10:00:00Z"),
      },
    ];
    const slots = feasibleSlots(
      prefs,
      60,
      new Date("2026-06-08T17:00:00Z"),
      occ,
      MON_MIDNIGHT,
    );
    expect(iso(slots[0])).toBe("2026-06-08T10:00:00.000Z");
    expect(slots).toHaveLength(25); // 29 on an empty day, minus 4 blocked starts (09:00–09:45)
    // None of the returned slots overlaps the occupied block.
    for (const s of slots) {
      const start = s.getTime();
      expect(start >= occ[0].end || start + 60 * 60_000 <= occ[0].start).toBe(
        true,
      );
    }
  });

  it("returns the slots collected so far when a candidate ends past the deadline", () => {
    // Deadline 11:00, 60-min task: feasible starts are 09:00,09:15,…,10:00 (ends
    // 11:00). The first start that ENDS past 11:00 (10:15→11:15) halts the scan.
    const slots = feasibleSlots(
      prefs,
      60,
      new Date("2026-06-08T11:00:00Z"),
      [],
      MON_MIDNIGHT,
    );
    expect(iso(slots[slots.length - 1])).toBe("2026-06-08T10:00:00.000Z");
    expect(
      slots.every(
        (s) => s.getTime() + 60 * 60_000 <= Date.parse("2026-06-08T11:00:00Z"),
      ),
    ).toBe(true);
  });

  it("is empty when no slot fits before the deadline (matches findSlot null)", () => {
    const slots = feasibleSlots(
      prefs,
      60,
      new Date("2026-06-08T09:30:00Z"),
      [],
      MON_MIDNIGHT,
    );
    expect(slots).toEqual([]);
    expect(
      findSlot(prefs, 60, new Date("2026-06-08T09:30:00Z"), [], MON_MIDNIGHT),
    ).toBeNull();
  });

  it("findSlot is exactly feasibleSlots()[0] across the existing scenarios", () => {
    const cases: Array<Parameters<typeof feasibleSlots>> = [
      [prefs, 60, null, [], MON_MIDNIGHT],
      [prefs, 60, null, [], new Date("2026-06-08T09:40:00Z")],
      [
        prefs,
        60,
        null,
        [
          {
            start: Date.parse("2026-06-08T09:00:00Z"),
            end: Date.parse("2026-06-08T10:00:00Z"),
          },
        ],
        MON_MIDNIGHT,
      ],
      [prefs, 60, null, [], new Date("2026-06-12T16:30:00Z")],
      [prefs, 60, null, [], MON_MIDNIGHT, new Date("2026-06-13T00:00:00Z")],
    ];
    for (const args of cases) {
      const first = feasibleSlots(...args)[0] ?? null;
      const single = findSlot(...args);
      expect(iso(single)).toBe(iso(first));
    }
  });
});

describe("findSlot — overnight (cross-midnight) windows", () => {
  // 22:00 → 04:00, wraps past midnight. workDays gate the start day.
  const owl: SchedulerPrefs = {
    workStart: 1320, // 22:00
    workEnd: 240, // 04:00
    workDays: [1, 2, 3, 4, 5], // Mon–Fri (the day the shift begins)
    timezone: "UTC",
  };

  it("places a flexible task at the window start (evening) when free", () => {
    // Empty Monday evening: first slot is 22:00 on the start day.
    const slot = findSlot(owl, 60, null, [], MON_MIDNIGHT);
    expect(iso(slot)).toBe("2026-06-08T22:00:00.000Z");
  });

  it("places into the post-midnight portion when the evening is occupied", () => {
    // Fill 22:00–04:00 of Monday's shift except the last hour (03:00–04:00),
    // forcing the task into the post-midnight tail on Tue 06-09.
    const occ = [
      {
        start: Date.parse("2026-06-08T22:00:00Z"),
        end: Date.parse("2026-06-09T03:00:00Z"),
      },
    ];
    const slot = findSlot(owl, 60, null, occ, MON_MIDNIGHT);
    expect(iso(slot)).toBe("2026-06-09T03:00:00.000Z");
    // Sanity: the slot is at/after midnight of the next calendar day.
    expect(slot!.getTime()).toBeGreaterThanOrEqual(
      Date.parse("2026-06-09T00:00:00Z"),
    );
  });

  it("fills the remaining morning when now is in the early-morning tail (d=-1 scan)", () => {
    // now = Tue 06-09 01:30, still inside the shift that started Mon 06-08 22:00.
    // The wrap scan begins at d=-1, so the morning tail (until 04:00) is usable.
    const slot = findSlot(owl, 60, null, [], new Date("2026-06-09T01:30:00Z"));
    expect(iso(slot)).toBe("2026-06-09T01:30:00.000Z");
  });

  it("rolls a weekend-eve overflow to the next workday's evening", () => {
    // Sat 06-13 is not a start workday; Fri 06-12 22:00→Sat 04:00 is the last
    // shift before Mon 06-15. A task that can't fit before Sat 04:00 rolls to
    // Monday evening (the next start workday). now just before the Sat tail end.
    const slot = findSlot(owl, 60, null, [], new Date("2026-06-13T03:30:00Z"));
    expect(iso(slot)).toBe("2026-06-15T22:00:00.000Z");
  });
});

describe("scheduleAll", () => {
  it("orders by deadline ascending (EDF)", () => {
    const out = scheduleAll(
      prefs,
      [
        task({ id: "a", deadline: new Date("2026-06-10T17:00:00Z") }),
        task({ id: "b", deadline: new Date("2026-06-09T17:00:00Z") }),
      ],
      MON_MIDNIGHT,
    );
    const byId = (id: string) => out.find((p) => p.id === id)!;
    expect(iso(byId("b").scheduledStartTime)).toBe("2026-06-08T09:00:00.000Z");
    expect(iso(byId("a").scheduledStartTime)).toBe("2026-06-08T10:00:00.000Z");
  });

  it("routes flexible tasks around fixed anchors", () => {
    const out = scheduleAll(
      prefs,
      [
        task({
          id: "fixed",
          fixed: true,
          scheduledStartTime: new Date("2026-06-08T09:00:00Z"),
        }),
        task({ id: "flex" }),
      ],
      MON_MIDNIGHT,
    );
    const byId = (id: string) => out.find((p) => p.id === id)!;
    expect(iso(byId("fixed").scheduledStartTime)).toBe(
      "2026-06-08T09:00:00.000Z",
    );
    expect(iso(byId("flex").scheduledStartTime)).toBe(
      "2026-06-08T10:00:00.000Z",
    );
  });

  it("flags unplaceable tasks as conflicts", () => {
    const out = scheduleAll(
      prefs,
      [
        task({
          id: "x",
          durationMinutes: 120,
          deadline: new Date("2026-06-08T10:00:00Z"),
        }),
      ],
      MON_MIDNIGHT,
    );
    expect(out[0].conflict).toBe(true);
    expect(out[0].scheduledStartTime).toBeNull();
  });

  it("is deterministic for the same input", () => {
    const tasks = [
      task({ id: "a", deadline: new Date("2026-06-10T17:00:00Z") }),
      task({ id: "b", deadline: new Date("2026-06-09T17:00:00Z") }),
    ];
    const a = scheduleAll(prefs, tasks, MON_MIDNIGHT);
    const b = scheduleAll(prefs, tasks, MON_MIDNIGHT);
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  it("packs independent flexible tasks from now in EDF order", () => {
    // Two deadline-less flexible tasks pack contiguously from the work start of
    // the current day — no day-pinning, just earliest-fit forward packing.
    const out = scheduleAll(
      prefs,
      [task({ id: "a" }), task({ id: "b" })],
      MON_MIDNIGHT,
    );
    const byId = (id: string) => out.find((p) => p.id === id)!;
    expect(iso(byId("a").scheduledStartTime)).toBe("2026-06-08T09:00:00.000Z");
    expect(iso(byId("b").scheduledStartTime)).toBe("2026-06-08T10:00:00.000Z");
  });
});

describe("scheduleAll — deadline-aware cascade (closer deadlines win)", () => {
  it("orders a new closer-deadline task before an existing looser-deadline auto-placed task", () => {
    // "existing" was auto-placed at 09:00 with a Wed deadline. A freshly-created
    // "new" task with a Tue (closer) deadline must take 09:00; the looser one
    // cascades to 10:00 — re-EDF gives the closer deadline the earlier slot.
    const out = scheduleAll(
      prefs,
      [
        task({
          id: "existing",
          deadline: new Date("2026-06-10T17:00:00Z"), // Wed
          scheduledStartTime: new Date("2026-06-08T09:00:00Z"),
        }),
        task({
          id: "new",
          deadline: new Date("2026-06-09T17:00:00Z"), // Tue — closer
        }),
      ],
      MON_MIDNIGHT,
    );
    const byId = (id: string) => out.find((p) => p.id === id)!;
    expect(iso(byId("new").scheduledStartTime)).toBe(
      "2026-06-08T09:00:00.000Z",
    );
    expect(iso(byId("existing").scheduledStartTime)).toBe(
      "2026-06-08T10:00:00.000Z",
    );
  });

  it("does NOT move a manually-moved task during the re-pack", () => {
    // "manual" was dragged to 14:00. A new no-deadline flexible task must pack
    // around it (taking 09:00) and never displace the anchored manual slot.
    const out = scheduleAll(
      prefs,
      [
        task({
          id: "manual",
          manuallyMoved: true,
          scheduledStartTime: new Date("2026-06-08T14:00:00Z"),
        }),
        task({ id: "flex" }),
      ],
      MON_MIDNIGHT,
    );
    const byId = (id: string) => out.find((p) => p.id === id)!;
    expect(iso(byId("manual").scheduledStartTime)).toBe(
      "2026-06-08T14:00:00.000Z",
    );
    expect(iso(byId("flex").scheduledStartTime)).toBe(
      "2026-06-08T09:00:00.000Z",
    );
  });

  it("keeps a manually-moved task even when a closer-deadline task is added", () => {
    // A new task with a closer deadline does NOT bump a manually-moved task off
    // its dragged slot; the manual placement is authoritative.
    const out = scheduleAll(
      prefs,
      [
        task({
          id: "manual",
          manuallyMoved: true,
          deadline: new Date("2026-06-11T17:00:00Z"), // looser
          scheduledStartTime: new Date("2026-06-08T09:00:00Z"),
        }),
        task({
          id: "urgent",
          deadline: new Date("2026-06-09T17:00:00Z"), // closer
        }),
      ],
      MON_MIDNIGHT,
    );
    const byId = (id: string) => out.find((p) => p.id === id)!;
    // Manual stays at 09:00; the urgent task packs around it at 10:00.
    expect(iso(byId("manual").scheduledStartTime)).toBe(
      "2026-06-08T09:00:00.000Z",
    );
    expect(iso(byId("urgent").scheduledStartTime)).toBe(
      "2026-06-08T10:00:00.000Z",
    );
  });

  it("recomputes a manually-moved task's conflict from real overlap (self-heal)", () => {
    // A lone manually-moved task carrying a stale `conflict: true` no longer
    // overlaps anything, so the final overlap pass clears it. Its dragged slot
    // is preserved.
    const out = scheduleAll(
      prefs,
      [
        task({
          id: "manual",
          manuallyMoved: true,
          conflict: true,
          scheduledStartTime: new Date("2026-06-08T09:00:00Z"),
        }),
      ],
      MON_MIDNIGHT,
    );
    expect(out[0].conflict).toBe(false);
    expect(iso(out[0].scheduledStartTime)).toBe("2026-06-08T09:00:00.000Z");
  });

  it("still anchors fixed and past tasks while EDF-packing the rest", () => {
    const NOON = new Date("2026-06-08T12:00:00Z");
    const out = scheduleAll(
      prefs,
      [
        // Past: started 09:00 before noon — frozen.
        task({
          id: "past",
          scheduledStartTime: new Date("2026-06-08T09:00:00Z"),
        }),
        // Fixed at 15:00 — anchored.
        task({
          id: "fixed",
          fixed: true,
          scheduledStartTime: new Date("2026-06-08T15:00:00Z"),
        }),
        // Flexible packs from noon, around the fixed block.
        task({ id: "flex" }),
      ],
      NOON,
    );
    const byId = (id: string) => out.find((p) => p.id === id)!;
    expect(iso(byId("past").scheduledStartTime)).toBe(
      "2026-06-08T09:00:00.000Z",
    );
    expect(iso(byId("fixed").scheduledStartTime)).toBe(
      "2026-06-08T15:00:00.000Z",
    );
    expect(byId("fixed").conflict).toBe(false);
    expect(iso(byId("flex").scheduledStartTime)).toBe(
      "2026-06-08T12:00:00.000Z",
    );
  });
});

describe("scheduleAll — overlapping anchors are flagged as conflicts", () => {
  it("flags BOTH a fixed task and the placed task it overlaps", () => {
    // "placed" was auto-scheduled at 09:00–10:00; a fixed task lands at
    // 09:30–10:30, overlapping it. Both must surface as conflicts.
    const out = scheduleAll(
      prefs,
      [
        task({
          id: "placed",
          manuallyMoved: true,
          scheduledStartTime: new Date("2026-06-08T09:00:00Z"),
        }),
        task({
          id: "fixed",
          fixed: true,
          scheduledStartTime: new Date("2026-06-08T09:30:00Z"),
        }),
      ],
      MON_MIDNIGHT,
    );
    const byId = (id: string) => out.find((p) => p.id === id)!;
    expect(byId("fixed").conflict).toBe(true);
    expect(byId("placed").conflict).toBe(true);
    // Neither anchor is moved off its stored slot.
    expect(iso(byId("fixed").scheduledStartTime)).toBe(
      "2026-06-08T09:30:00.000Z",
    );
    expect(iso(byId("placed").scheduledStartTime)).toBe(
      "2026-06-08T09:00:00.000Z",
    );
  });

  it("flags two overlapping fixed tasks on both sides", () => {
    const out = scheduleAll(
      prefs,
      [
        task({
          id: "f1",
          fixed: true,
          scheduledStartTime: new Date("2026-06-08T09:00:00Z"),
        }),
        task({
          id: "f2",
          fixed: true,
          scheduledStartTime: new Date("2026-06-08T09:30:00Z"),
        }),
      ],
      MON_MIDNIGHT,
    );
    const byId = (id: string) => out.find((p) => p.id === id)!;
    expect(byId("f1").conflict).toBe(true);
    expect(byId("f2").conflict).toBe(true);
  });

  it("keeps a fixed task in a free slot conflict:false", () => {
    const out = scheduleAll(
      prefs,
      [
        task({
          id: "fixed",
          fixed: true,
          scheduledStartTime: new Date("2026-06-08T09:00:00Z"),
        }),
        task({
          id: "other",
          fixed: true,
          scheduledStartTime: new Date("2026-06-08T11:00:00Z"),
        }),
      ],
      MON_MIDNIGHT,
    );
    const byId = (id: string) => out.find((p) => p.id === id)!;
    expect(byId("fixed").conflict).toBe(false);
    expect(byId("other").conflict).toBe(false);
  });

  it("clears the conflict once the overlapping task is moved away (self-heal)", () => {
    // Same two anchors as the first case, but "placed" is now dragged to 14:00 —
    // no overlap remains, so neither is flagged.
    const out = scheduleAll(
      prefs,
      [
        task({
          id: "placed",
          manuallyMoved: true,
          conflict: true, // stale verdict from the previous overlap
          scheduledStartTime: new Date("2026-06-08T14:00:00Z"),
        }),
        task({
          id: "fixed",
          fixed: true,
          conflict: true, // stale verdict from the previous overlap
          scheduledStartTime: new Date("2026-06-08T09:30:00Z"),
        }),
      ],
      MON_MIDNIGHT,
    );
    const byId = (id: string) => out.find((p) => p.id === id)!;
    expect(byId("fixed").conflict).toBe(false);
    expect(byId("placed").conflict).toBe(false);
  });

  it("does not flag non-overlapping past and future tasks (no false positive)", () => {
    // now = noon. A past block (09:00–10:00) and a future fixed task (13:00) do
    // NOT overlap in time, so neither is flagged. Detection is now-independent
    // but it is still pure interval overlap — separated tasks stay clean
    // regardless of which side of `now` they sit on.
    const NOON = new Date("2026-06-08T12:00:00Z");
    const out = scheduleAll(
      prefs,
      [
        task({
          id: "past",
          scheduledStartTime: new Date("2026-06-08T09:00:00Z"),
        }),
        task({
          id: "futureFixed",
          fixed: true,
          scheduledStartTime: new Date("2026-06-08T13:00:00Z"),
        }),
      ],
      NOON,
    );
    const byId = (id: string) => out.find((p) => p.id === id)!;
    expect(byId("past").conflict).toBe(false);
    expect(byId("futureFixed").conflict).toBe(false);
  });

  it("never places a flexible task onto a fixed anchor (no overlap created)", () => {
    // A fixed task occupies 09:00–10:00; a flexible no-deadline task must pack
    // around it at 10:00 and stay conflict-free.
    const out = scheduleAll(
      prefs,
      [
        task({
          id: "fixed",
          fixed: true,
          scheduledStartTime: new Date("2026-06-08T09:00:00Z"),
        }),
        task({ id: "flex" }),
      ],
      MON_MIDNIGHT,
    );
    const byId = (id: string) => out.find((p) => p.id === id)!;
    expect(iso(byId("flex").scheduledStartTime)).toBe(
      "2026-06-08T10:00:00.000Z",
    );
    expect(byId("flex").conflict).toBe(false);
    expect(byId("fixed").conflict).toBe(false);
  });
});

describe("scheduleAll — per-task scheduling floor (create-day anchor)", () => {
  it("anchors a no-deadline task to its FUTURE create day, never back-filling earlier", () => {
    // "anchored" was created while viewing Wed 06-10; with no deadline it must
    // land at the start of that day, NOT be packed at the first free slot from
    // now (Mon 06-08). The deadline-bearing "urgent" packs from now regardless.
    const out = scheduleAll(
      prefs,
      [
        task({
          id: "anchored",
          schedulingAnchor: new Date("2026-06-10T00:00:00Z"), // Wed
        }),
        task({
          id: "urgent",
          deadline: new Date("2026-06-09T17:00:00Z"), // Tue
        }),
      ],
      MON_MIDNIGHT,
    );
    const byId = (id: string) => out.find((p) => p.id === id)!;
    expect(iso(byId("urgent").scheduledStartTime)).toBe(
      "2026-06-08T09:00:00.000Z",
    );
    expect(iso(byId("anchored").scheduledStartTime)).toBe(
      "2026-06-10T09:00:00.000Z",
    );
  });

  it("a deadline-bearing task IGNORES its anchor and packs from now by EDF", () => {
    // Even with a future create-day anchor, the presence of a deadline switches
    // the task to pure urgency: scheduled as early as possible from now.
    const out = scheduleAll(
      prefs,
      [
        task({
          id: "withDeadline",
          deadline: new Date("2026-06-12T17:00:00Z"),
          schedulingAnchor: new Date("2026-06-10T00:00:00Z"), // future — ignored
        }),
      ],
      MON_MIDNIGHT,
    );
    expect(iso(out[0].scheduledStartTime)).toBe("2026-06-08T09:00:00.000Z");
  });

  it("clamps a PAST anchor up to now (no scheduling in the past)", () => {
    // now = Wed 06-10 11:00; the anchor (Mon 06-08) is past, so the floor
    // collapses to now and the task packs from the next slot at/after now.
    const out = scheduleAll(
      prefs,
      [
        task({
          id: "stale",
          schedulingAnchor: new Date("2026-06-08T00:00:00Z"), // Mon (past)
        }),
      ],
      new Date("2026-06-10T11:00:00Z"),
    );
    expect(iso(out[0].scheduledStartTime)).toBe("2026-06-10T11:00:00.000Z");
  });

  it("a null anchor floors at now (no day-pinning)", () => {
    const out = scheduleAll(prefs, [task({ id: "n" })], MON_MIDNIGHT);
    expect(iso(out[0].scheduledStartTime)).toBe("2026-06-08T09:00:00.000Z");
  });
});

describe("scheduleAll — period ceiling (schedulingDeadline) for no-deadline tasks", () => {
  // Period end (exclusive) of Tue 06-09 day view, UTC: Wed 06-10 00:00.
  const WED_MIDNIGHT = new Date("2026-06-10T00:00:00Z");
  // It is 23:00 Tue: the day's 09:00–17:00 work window is already over.
  const TUE_11PM = new Date("2026-06-09T23:00:00Z");

  it("leaves a no-deadline task UNPLACED when it can't fit the period's work hours", () => {
    // Created 23:00 Tue, anchored on Tue, ceilinged at the end of Tue. There is
    // no working-hours slot left before the period ends → unplaced + conflict,
    // NOT silently rolled to Wed 09:00.
    const out = scheduleAll(
      prefs,
      [
        task({
          id: "overflow",
          schedulingAnchor: new Date("2026-06-09T00:00:00Z"),
          schedulingDeadline: WED_MIDNIGHT,
        }),
      ],
      TUE_11PM,
    );
    expect(out[0].scheduledStartTime).toBeNull();
    expect(out[0].conflict).toBe(true);
  });

  it("STAYS unplaced on a second scheduleAll (stability across cascades)", () => {
    // The period bound lives in the scheduling logic, so re-packing (triggered by
    // any later create/delete/complete) must NOT silently re-place it.
    const tasks = [
      task({
        id: "overflow",
        schedulingAnchor: new Date("2026-06-09T00:00:00Z"),
        schedulingDeadline: WED_MIDNIGHT,
      }),
    ];
    const first = scheduleAll(prefs, tasks, TUE_11PM);
    const second = scheduleAll(prefs, tasks, TUE_11PM);
    expect(first[0].scheduledStartTime).toBeNull();
    expect(second[0].scheduledStartTime).toBeNull();
  });

  it("PLACES a no-deadline task that DOES fit within its period", () => {
    // Created Tue morning (anchor Tue), ceilinged at end of Tue. now is Tue
    // 09:00, so the work window is open → lands at Tue 09:00.
    const out = scheduleAll(
      prefs,
      [
        task({
          id: "fits",
          schedulingAnchor: new Date("2026-06-09T00:00:00Z"),
          schedulingDeadline: WED_MIDNIGHT,
        }),
      ],
      new Date("2026-06-09T09:00:00Z"),
    );
    expect(iso(out[0].scheduledStartTime)).toBe("2026-06-09T09:00:00.000Z");
    expect(out[0].conflict).toBe(false);
  });

  it("a no-deadline task with a WEEK ceiling rolls within the week but not past it", () => {
    // Anchor Tue, week ceiling = next Mon 06-15 00:00. now Tue 23:00 → Tue's work
    // window is over, but Wed 06-10 09:00 is still inside the week → placed there.
    const out = scheduleAll(
      prefs,
      [
        task({
          id: "weekly",
          schedulingAnchor: new Date("2026-06-09T00:00:00Z"),
          schedulingDeadline: new Date("2026-06-15T00:00:00Z"),
        }),
      ],
      TUE_11PM,
    );
    expect(iso(out[0].scheduledStartTime)).toBe("2026-06-10T09:00:00.000Z");
  });

  it("a USER deadline takes precedence over the period ceiling (unchanged)", () => {
    // A deadline-bearing task ignores the anchor floor AND uses its deadline as
    // the ceiling, not schedulingDeadline — byte-for-byte the old behavior: it
    // packs from now by EDF urgency.
    const out = scheduleAll(
      prefs,
      [
        task({
          id: "withDeadline",
          deadline: new Date("2026-06-12T17:00:00Z"),
          schedulingAnchor: new Date("2026-06-09T00:00:00Z"),
          schedulingDeadline: new Date("2026-06-10T00:00:00Z"), // ignored
        }),
      ],
      MON_MIDNIGHT,
    );
    expect(iso(out[0].scheduledStartTime)).toBe("2026-06-08T09:00:00.000Z");
  });

  it("an absent schedulingDeadline is unbounded (legacy no-deadline behavior)", () => {
    // No ceiling → the no-deadline task rolls forward to the next free working
    // slot as before. Created 23:00 Tue with no ceiling → Wed 06-10 09:00.
    const out = scheduleAll(
      prefs,
      [
        task({
          id: "legacy",
          schedulingAnchor: new Date("2026-06-09T00:00:00Z"),
        }),
      ],
      TUE_11PM,
    );
    expect(iso(out[0].scheduledStartTime)).toBe("2026-06-10T09:00:00.000Z");
  });
});

describe("scheduleAll — cross-day single task for a wrapping work window", () => {
  // Night owl: 22:00 → 06:00, Mon–Fri (the day the shift STARTS).
  const owl: SchedulerPrefs = {
    workStart: 1320, // 22:00
    workEnd: 360, // 06:00
    workDays: [1, 2, 3, 4, 5],
    timezone: "UTC",
  };
  // The create-day anchor (start-of-day Mon 06-08, the shift's start day).
  const MON_ANCHOR = new Date("2026-06-08T00:00:00Z");
  // The day-view ceiling the SERVICE would compute for this anchor: not bare
  // Tue 00:00 but Tue 06:00 (workEnd the next morning) for the wrapping window.
  const dayCeiling = endOfPeriod(MON_ANCHOR, "day", owl.timezone, {
    workStart: owl.workStart,
    workEnd: owl.workEnd,
  });

  it("places a 4h task at 22:00 as ONE block crossing midnight (ends 02:00)", () => {
    // The repro: a 240-min no-deadline task in day view. With the extended
    // ceiling (Tue 06:00) the single 22:00→02:00 block fits the post-midnight
    // tail — one row, one start, duration unchanged.
    expect(iso(dayCeiling)).toBe("2026-06-09T06:00:00.000Z");
    const out = scheduleAll(
      owl,
      [
        task({
          id: "owl",
          durationMinutes: 240,
          schedulingAnchor: MON_ANCHOR,
          schedulingDeadline: dayCeiling,
        }),
      ],
      MON_ANCHOR,
    );
    expect(iso(out[0].scheduledStartTime)).toBe("2026-06-08T22:00:00.000Z");
    expect(out[0].conflict).toBe(false);
  });

  it("would be UNPLACED under the old bare-00:00 day ceiling (regression guard)", () => {
    // Same task, but ceilinged at Tue 00:00 (the pre-fix day ceiling): the
    // 22:00→02:00 block overshoots midnight → no slot → unplaced. This is the
    // exact behavior the extended ceiling fixes.
    const out = scheduleAll(
      owl,
      [
        task({
          id: "owl",
          durationMinutes: 240,
          schedulingAnchor: MON_ANCHOR,
          schedulingDeadline: new Date("2026-06-09T00:00:00Z"),
        }),
      ],
      MON_ANCHOR,
    );
    expect(out[0].scheduledStartTime).toBeNull();
    expect(out[0].conflict).toBe(true);
  });

  it("places the LATE-evening tail of the window when the early part is busy", () => {
    // 22:00–01:00 occupied by a fixed anchor; a 2h task then lands at 01:00
    // crossing into 03:00 — still one block within the extended Tue-06:00
    // ceiling, in the post-midnight tail of the window.
    const out = scheduleAll(
      owl,
      [
        task({
          id: "owl",
          durationMinutes: 120,
          schedulingAnchor: MON_ANCHOR,
          schedulingDeadline: dayCeiling,
        }),
        task({
          id: "fixedBlock",
          fixed: true,
          durationMinutes: 180, // 22:00 → 01:00
          scheduledStartTime: new Date("2026-06-08T22:00:00Z"),
        }),
      ],
      MON_ANCHOR,
    );
    const byId = (id: string) => out.find((p) => p.id === id)!;
    expect(iso(byId("owl").scheduledStartTime)).toBe(
      "2026-06-09T01:00:00.000Z",
    );
    expect(byId("owl").conflict).toBe(false);
  });
});

describe("compareEdf — EDF ordering and tie-breaking", () => {
  it("orders earlier deadlines first", () => {
    const a = task({ id: "a", deadline: new Date("2026-06-09T17:00:00Z") });
    const b = task({ id: "b", deadline: new Date("2026-06-10T17:00:00Z") });
    expect(compareEdf(a, b)).toBeLessThan(0);
    expect(compareEdf(b, a)).toBeGreaterThan(0);
  });

  it("treats a null deadline as +Infinity (sorts last)", () => {
    const dated = task({ id: "a", deadline: new Date("2026-06-10T17:00:00Z") });
    const undated = task({ id: "b", deadline: null });
    expect(compareEdf(dated, undated)).toBeLessThan(0);
    expect(compareEdf(undated, dated)).toBeGreaterThan(0);
  });

  it("breaks an equal-deadline tie by createdAt ascending", () => {
    const dl = new Date("2026-06-10T17:00:00Z");
    const older = task({
      id: "older",
      deadline: dl,
      createdAt: new Date("2026-06-01T00:00:00Z"),
    });
    const newer = task({
      id: "newer",
      deadline: dl,
      createdAt: new Date("2026-06-02T00:00:00Z"),
    });
    expect(compareEdf(older, newer)).toBeLessThan(0);
    expect(compareEdf(newer, older)).toBeGreaterThan(0);
  });

  it("breaks a both-null-deadline tie by createdAt ascending", () => {
    const older = task({
      id: "older",
      deadline: null,
      createdAt: new Date("2026-06-01T00:00:00Z"),
    });
    const newer = task({
      id: "newer",
      deadline: null,
      createdAt: new Date("2026-06-02T00:00:00Z"),
    });
    expect(compareEdf(older, newer)).toBeLessThan(0);
  });

  it("is 0 for identical deadline and createdAt", () => {
    const dl = new Date("2026-06-10T17:00:00Z");
    const created = new Date("2026-06-01T00:00:00Z");
    const a = task({ id: "a", deadline: dl, createdAt: created });
    const b = task({ id: "b", deadline: dl, createdAt: created });
    expect(compareEdf(a, b)).toBe(0);
  });
});

describe("isPast", () => {
  const NOON = new Date("2026-06-08T12:00:00Z");

  it("is false for a task with no scheduledStartTime", () => {
    expect(isPast({ scheduledStartTime: null }, NOON)).toBe(false);
  });

  it("is true when the start is strictly before now", () => {
    expect(
      isPast({ scheduledStartTime: new Date("2026-06-08T09:00:00Z") }, NOON),
    ).toBe(true);
  });

  it("is false at exactly now and in the future", () => {
    expect(isPast({ scheduledStartTime: NOON }, NOON)).toBe(false);
    expect(
      isPast({ scheduledStartTime: new Date("2026-06-08T13:00:00Z") }, NOON),
    ).toBe(false);
  });
});

describe("scheduleAll — frozen past tasks", () => {
  // Mid-day clock: anything placed at 09:00 is past; the afternoon is future.
  const NOON = new Date("2026-06-08T12:00:00Z");

  it("leaves a past plain task untouched while EDF-packing future tasks", () => {
    const out = scheduleAll(
      prefs,
      [
        // Past: started 09:00, before noon. Must stay exactly here.
        task({
          id: "past",
          scheduledStartTime: new Date("2026-06-08T09:00:00Z"),
        }),
        // Future flexible tasks pack from now (noon) onward.
        task({ id: "a", deadline: new Date("2026-06-09T17:00:00Z") }),
        task({ id: "b", deadline: new Date("2026-06-10T17:00:00Z") }),
      ],
      NOON,
    );
    const byId = (id: string) => out.find((p) => p.id === id)!;
    expect(iso(byId("past").scheduledStartTime)).toBe(
      "2026-06-08T09:00:00.000Z",
    );
    expect(byId("past").conflict).toBe(false);
    // Future tasks pack from noon, EDF order, ignoring the past block entirely.
    expect(iso(byId("a").scheduledStartTime)).toBe("2026-06-08T12:00:00.000Z");
    expect(iso(byId("b").scheduledStartTime)).toBe("2026-06-08T13:00:00.000Z");
  });

  it("recomputes a lone past task's conflict from real overlap (self-heal, now-independent)", () => {
    // Inverted from the old "past conflict is frozen" assertion: detection no
    // longer freezes past verdicts. A lone past task carrying a stale
    // `conflict: true` overlaps nothing, so the now-independent overlap pass
    // clears it — while its stored slot is still never moved.
    const out = scheduleAll(
      prefs,
      [
        task({
          id: "past",
          conflict: true,
          scheduledStartTime: new Date("2026-06-08T09:00:00Z"),
        }),
      ],
      NOON,
    );
    expect(iso(out[0].scheduledStartTime)).toBe("2026-06-08T09:00:00.000Z");
    expect(out[0].conflict).toBe(false);
  });

  it("flags BOTH fully-elapsed tasks that overlap (now-independent detection)", () => {
    // Two tasks that both ended before now (08:00–09:00 and 08:30–09:30) overlap
    // in the elapsed part of the window. Detection is now-independent, so both
    // are flagged conflict:true (would be counted in the header badge). Neither
    // stored slot is moved.
    const out = scheduleAll(
      prefs,
      [
        task({
          id: "e1",
          scheduledStartTime: new Date("2026-06-08T08:00:00Z"),
          durationMinutes: 60,
        }),
        task({
          id: "e2",
          scheduledStartTime: new Date("2026-06-08T08:30:00Z"),
          durationMinutes: 60,
        }),
      ],
      NOON,
    );
    const byId = (id: string) => out.find((p) => p.id === id)!;
    expect(byId("e1").conflict).toBe(true);
    expect(byId("e2").conflict).toBe(true);
    expect(iso(byId("e1").scheduledStartTime)).toBe("2026-06-08T08:00:00.000Z");
    expect(iso(byId("e2").scheduledStartTime)).toBe("2026-06-08T08:30:00.000Z");
  });

  it("self-heals an elapsed overlap once the tasks no longer overlap", () => {
    // Same two elapsed tasks, but e2 now sits at 09:30 (after e1's 08:00–09:00).
    // No overlap remains, so both clear to conflict:false even though both are
    // fully in the past.
    const out = scheduleAll(
      prefs,
      [
        task({
          id: "e1",
          conflict: true, // stale verdict from the previous overlap
          scheduledStartTime: new Date("2026-06-08T08:00:00Z"),
          durationMinutes: 60,
        }),
        task({
          id: "e2",
          conflict: true, // stale verdict from the previous overlap
          scheduledStartTime: new Date("2026-06-08T09:30:00Z"),
          durationMinutes: 60,
        }),
      ],
      NOON,
    );
    const byId = (id: string) => out.find((p) => p.id === id)!;
    expect(byId("e1").conflict).toBe(false);
    expect(byId("e2").conflict).toBe(false);
  });

  it("does not let a FULLY-ELAPSED block displace a future task onto a later slot", () => {
    // A future task whose earliest packing slot (noon) does not overlap the past
    // block — it must take noon, not be pushed past the 09:00–10:00 stale block.
    const out = scheduleAll(
      prefs,
      [
        task({
          id: "past",
          scheduledStartTime: new Date("2026-06-08T09:00:00Z"),
        }),
        task({ id: "future" }),
      ],
      NOON,
    );
    const byId = (id: string) => out.find((p) => p.id === id)!;
    expect(iso(byId("future").scheduledStartTime)).toBe(
      "2026-06-08T12:00:00.000Z",
    );
  });
});

describe("hasElapsed", () => {
  const NOW = new Date("2026-06-08T16:16:00Z");

  it("is false for a task with no scheduledStartTime", () => {
    expect(
      hasElapsed({ scheduledStartTime: null, durationMinutes: 60 }, NOW),
    ).toBe(false);
  });

  it("is true when the interval ends at/before now (fully elapsed)", () => {
    // 14:00 + 60min = 15:00 <= 16:16.
    expect(
      hasElapsed(
        {
          scheduledStartTime: new Date("2026-06-08T14:00:00Z"),
          durationMinutes: 60,
        },
        NOW,
      ),
    ).toBe(true);
  });

  it("is false for an in-progress task (start < now < end)", () => {
    // 16:00–18:00 straddles now.
    expect(
      hasElapsed(
        {
          scheduledStartTime: new Date("2026-06-08T16:00:00Z"),
          durationMinutes: 120,
        },
        NOW,
      ),
    ).toBe(false);
  });

  it("is false at exactly the end boundary minus a slot, true at the boundary", () => {
    // end == now is treated as elapsed (half-open intervals).
    expect(
      hasElapsed(
        {
          scheduledStartTime: new Date("2026-06-08T15:16:00Z"),
          durationMinutes: 60,
        },
        NOW,
      ),
    ).toBe(true);
  });
});

describe("scheduleAll — in-progress (frozen, not elapsed) tasks block placement", () => {
  // now = 16:16; an extended work window so the afternoon is schedulable.
  const lateWindow: SchedulerPrefs = {
    workStart: 540, // 09:00
    workEnd: 1320, // 22:00
    workDays: [1, 2, 3, 4, 5],
    timezone: "UTC",
  };
  const NOW = new Date("2026-06-08T16:16:00Z");

  it("places a new flexible task AFTER an in-progress block (the repro)", () => {
    // In-progress task runs 16:00–18:00 (started before now, ends after). A new
    // 1h flexible task must NOT overlap it — it lands at 18:00, not 16:30.
    const out = scheduleAll(
      lateWindow,
      [
        task({
          id: "inprogress",
          scheduledStartTime: new Date("2026-06-08T16:00:00Z"),
          durationMinutes: 120,
        }),
        task({ id: "new", durationMinutes: 60 }),
      ],
      NOW,
    );
    const byId = (id: string) => out.find((p) => p.id === id)!;
    expect(iso(byId("new").scheduledStartTime)).toBe(
      "2026-06-08T18:00:00.000Z",
    );
  });

  it("does NOT move the in-progress task and leaves its conflict untouched", () => {
    const out = scheduleAll(
      lateWindow,
      [
        task({
          id: "inprogress",
          conflict: false,
          scheduledStartTime: new Date("2026-06-08T16:00:00Z"),
          durationMinutes: 120,
        }),
        task({ id: "new", durationMinutes: 60 }),
      ],
      NOW,
    );
    const byId = (id: string) => out.find((p) => p.id === id)!;
    expect(iso(byId("inprogress").scheduledStartTime)).toBe(
      "2026-06-08T16:00:00.000Z",
    );
    // The in-progress task is never MOVED (placement is frozen). Its conflict is
    // recomputed but it overlaps nothing here (the new task is placed at 18:00),
    // so it stays clean.
    expect(byId("inprogress").conflict).toBe(false);
  });

  it("recomputes a lone in-progress task's conflict from real overlap (self-heal)", () => {
    // Inverted from the old "frozen conflict is preserved" assertion: detection
    // is now-independent. A lone in-progress task carrying a stale
    // `conflict: true` overlaps nothing, so it clears — its slot is untouched.
    const out = scheduleAll(
      lateWindow,
      [
        task({
          id: "inprogress",
          conflict: true,
          scheduledStartTime: new Date("2026-06-08T16:00:00Z"),
          durationMinutes: 120,
        }),
      ],
      NOW,
    );
    expect(out[0].conflict).toBe(false);
    expect(iso(out[0].scheduledStartTime)).toBe("2026-06-08T16:00:00.000Z");
  });

  it("flags BOTH a future fixed task and the in-progress block it overlaps", () => {
    // A fixed task at 17:00 lands inside the 16:00–18:00 in-progress block.
    // Detection is now-independent and pairwise, so BOTH sides surface a
    // conflict (previously only the live fixed side was flagged). Neither slot
    // moves.
    const out = scheduleAll(
      lateWindow,
      [
        task({
          id: "inprogress",
          scheduledStartTime: new Date("2026-06-08T16:00:00Z"),
          durationMinutes: 120,
        }),
        task({
          id: "fixed",
          fixed: true,
          scheduledStartTime: new Date("2026-06-08T17:00:00Z"),
          durationMinutes: 60,
        }),
      ],
      NOW,
    );
    const byId = (id: string) => out.find((p) => p.id === id)!;
    expect(byId("fixed").conflict).toBe(true);
    expect(byId("inprogress").conflict).toBe(true);
    expect(iso(byId("inprogress").scheduledStartTime)).toBe(
      "2026-06-08T16:00:00.000Z",
    );
  });

  it("DOES flag an overlap with a FULLY-ELAPSED block (detection is now-independent)", () => {
    // Inverted from the old "past block never blocks" assertion: conflict
    // DETECTION no longer depends on `now`. Elapsed block 14:00–15:00 (ends
    // before now) overlaps a fixed task at 14:30 in wall-clock terms, so BOTH
    // are flagged. PLACEMENT is unaffected — the elapsed block still occupies no
    // future time and the fixed task keeps its stored slot here.
    const out = scheduleAll(
      lateWindow,
      [
        task({
          id: "elapsed",
          scheduledStartTime: new Date("2026-06-08T14:00:00Z"),
          durationMinutes: 60,
        }),
        task({
          id: "fixed",
          fixed: true,
          scheduledStartTime: new Date("2026-06-08T14:30:00Z"),
          durationMinutes: 60,
        }),
      ],
      NOW,
    );
    const byId = (id: string) => out.find((p) => p.id === id)!;
    expect(byId("fixed").conflict).toBe(true);
    expect(byId("elapsed").conflict).toBe(true);
    // Neither is moved off its stored slot.
    expect(iso(byId("elapsed").scheduledStartTime)).toBe(
      "2026-06-08T14:00:00.000Z",
    );
    expect(iso(byId("fixed").scheduledStartTime)).toBe(
      "2026-06-08T14:30:00.000Z",
    );
  });
});
