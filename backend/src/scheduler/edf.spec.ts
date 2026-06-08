import {
  type EdfTask,
  findSlot,
  isPast,
  placeOne,
  scheduleAll,
  type SchedulerPrefs,
} from "./edf";

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

  it("preserves a manually-moved task's stored conflict flag", () => {
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
    expect(out[0].conflict).toBe(true);
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

describe("placeOne", () => {
  it("places a new task in the earliest free slot around existing ones", () => {
    const others = [
      task({ id: "o", scheduledStartTime: new Date("2026-06-08T09:00:00Z") }),
    ];
    const p = placeOne(prefs, task({ id: "n" }), others, MON_MIDNIGHT);
    expect(iso(p.scheduledStartTime)).toBe("2026-06-08T10:00:00.000Z");
  });

  it("honours the earliest anchor (the day the task was created from)", () => {
    const p = placeOne(
      prefs,
      task({ id: "n" }),
      [],
      MON_MIDNIGHT,
      new Date("2026-06-10T00:00:00Z"), // created while viewing Wed the 10th
    );
    expect(iso(p.scheduledStartTime)).toBe("2026-06-10T09:00:00.000Z");
  });

  it("never schedules before now even if the anchor is in the past", () => {
    const p = placeOne(
      prefs,
      task({ id: "n" }),
      [],
      new Date("2026-06-10T11:00:00Z"), // now: Wed the 10th, late morning
      new Date("2026-06-08T00:00:00Z"), // anchor: Mon the 8th (past)
    );
    expect(iso(p.scheduledStartTime)).toBe("2026-06-10T11:00:00.000Z");
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

  it("preserves a past task's stored conflict flag unchanged", () => {
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
    expect(out[0].conflict).toBe(true);
  });

  it("does not let a past block displace a future task onto a later slot", () => {
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

describe("placeOne — frozen past tasks", () => {
  const NOON = new Date("2026-06-08T12:00:00Z");

  it("ignores a past task's interval when placing a new task", () => {
    // The only other task is a past block at 09:00; a fresh task must not treat
    // it as occupying and lands at the earliest live slot (noon).
    const others = [
      task({
        id: "past",
        scheduledStartTime: new Date("2026-06-08T09:00:00Z"),
      }),
    ];
    const p = placeOne(prefs, task({ id: "n" }), others, NOON);
    expect(iso(p.scheduledStartTime)).toBe("2026-06-08T12:00:00.000Z");
  });

  it("never lands a new task in the past (findSlot now-clamp, unchanged)", () => {
    const p = placeOne(
      prefs,
      task({ id: "n" }),
      [],
      NOON,
      new Date("2026-06-08T00:00:00Z"), // anchor in the past
    );
    expect(iso(p.scheduledStartTime)).toBe("2026-06-08T12:00:00.000Z");
  });
});
