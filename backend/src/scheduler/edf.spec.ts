import {
  cascadeReschedule,
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
  scheduledStartTime: null,
  createdAt: MON_MIDNIGHT,
  seriesId: null,
  conflict: false,
  ...over,
});

/** 'YYYY-MM-DD' in UTC (the spec's prefs timezone) for an instant. */
const dayStr = (d: Date) => d.toISOString().slice(0, 10);

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

  it("skips a non-working day by default (ignoreWorkDays omitted)", () => {
    // 2026-06-13 is a Saturday; earliest pins the search to it, but the default
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

  it("places within a non-working day's work window when ignoreWorkDays is set", () => {
    // Saturday 06-13: with ignoreWorkDays it places at that day's work start,
    // pinned there by the earliest anchor + same-day deadline.
    const slot = findSlot(
      prefs,
      60,
      new Date("2026-06-13T17:00:00Z"), // day work-end as placement deadline
      [],
      MON_MIDNIGHT,
      new Date("2026-06-13T00:00:00Z"),
      { ignoreWorkDays: true },
    );
    expect(iso(slot)).toBe("2026-06-13T09:00:00.000Z");
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

  it("keeps a recurring daily series on its own days (regression: no collapse)", () => {
    // FREQ=DAILY-style series: one occurrence per consecutive day Mon–Fri, all
    // sharing seriesId "s1", deadline null, each already placed at 09:00 on its
    // day. Before the fix scheduleAll EDF-packs them onto Monday 06-08; the fix
    // pins each back to its own day.
    const occDays = [
      "2026-06-08",
      "2026-06-09",
      "2026-06-10",
      "2026-06-11",
      "2026-06-12",
    ];
    const tasks = occDays.map((d, i) =>
      task({
        id: `s1-${i}`,
        seriesId: "s1",
        scheduledStartTime: new Date(`${d}T09:00:00Z`),
      }),
    );
    const out = scheduleAll(prefs, tasks, MON_MIDNIGHT);
    const placedDays = out.map((p) => dayStr(p.scheduledStartTime!));
    // Each occurrence stays on its own distinct day — not collapsed onto 06-08.
    expect(placedDays.sort()).toEqual([...occDays]);
    expect(new Set(placedDays).size).toBe(occDays.length);
    expect(out.every((p) => !p.conflict)).toBe(true);
  });

  it("re-flows a pinned occurrence's time-of-day into a changed work window", () => {
    // Work window moved to 13:00–17:00; the Wednesday occurrence stays on
    // Wed 06-10 but its start lands inside the new window.
    const shifted: SchedulerPrefs = { ...prefs, workStart: 780 }; // 13:00
    const out = scheduleAll(
      shifted,
      [
        task({
          id: "occ",
          seriesId: "s1",
          scheduledStartTime: new Date("2026-06-10T09:00:00Z"), // old window
        }),
      ],
      MON_MIDNIGHT,
    );
    expect(dayStr(out[0].scheduledStartTime!)).toBe("2026-06-10");
    expect(iso(out[0].scheduledStartTime)).toBe("2026-06-10T13:00:00.000Z");
  });

  it("pins recurring occurrences on their days while plain flexible packs from now", () => {
    // A daily series on Tue+Wed plus a plain flexible task. The plain task fills
    // the earliest gap from now (Monday) and the occurrences keep their days.
    const out = scheduleAll(
      prefs,
      [
        task({
          id: "occ-tue",
          seriesId: "s1",
          scheduledStartTime: new Date("2026-06-09T09:00:00Z"),
        }),
        task({
          id: "occ-wed",
          seriesId: "s1",
          scheduledStartTime: new Date("2026-06-10T09:00:00Z"),
        }),
        task({ id: "plain" }),
      ],
      MON_MIDNIGHT,
    );
    const byId = (id: string) => out.find((p) => p.id === id)!;
    expect(iso(byId("occ-tue").scheduledStartTime)).toBe(
      "2026-06-09T09:00:00.000Z",
    );
    expect(iso(byId("occ-wed").scheduledStartTime)).toBe(
      "2026-06-10T09:00:00.000Z",
    );
    // Plain flexible isn't day-pinned: packs from now on Monday.
    expect(iso(byId("plain").scheduledStartTime)).toBe(
      "2026-06-08T09:00:00.000Z",
    );
  });

  it("treats a recurring occurrence with no current placement as plain flexible", () => {
    // seriesId set but scheduledStartTime null (previously unplaced): its day is
    // unrecoverable, so it falls back to EDF-from-now packing.
    const out = scheduleAll(
      prefs,
      [task({ id: "lost", seriesId: "s1", scheduledStartTime: null })],
      MON_MIDNIGHT,
    );
    expect(iso(out[0].scheduledStartTime)).toBe("2026-06-08T09:00:00.000Z");
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

  it("does NOT re-anchor or re-flag a past day-pinned recurring occurrence", () => {
    // A past occurrence of a daily series, currently conflict-free at 09:00.
    // Without the freeze, placePinnedOccurrence would re-anchor it on its day
    // (and flag it as a standing conflict). It must be left exactly as stored.
    const out = scheduleAll(
      prefs,
      [
        task({
          id: "occ-past",
          seriesId: "s1",
          scheduledStartTime: new Date("2026-06-08T09:00:00Z"),
        }),
        task({
          id: "occ-future",
          seriesId: "s1",
          scheduledStartTime: new Date("2026-06-09T09:00:00Z"),
        }),
      ],
      NOON,
    );
    const byId = (id: string) => out.find((p) => p.id === id)!;
    expect(iso(byId("occ-past").scheduledStartTime)).toBe(
      "2026-06-08T09:00:00.000Z",
    );
    expect(byId("occ-past").conflict).toBe(false);
    // The future occurrence stays day-pinned on its own day.
    expect(iso(byId("occ-future").scheduledStartTime)).toBe(
      "2026-06-09T09:00:00.000Z",
    );
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

describe("cascadeReschedule — frozen past tasks", () => {
  const NOON = new Date("2026-06-08T12:00:00Z");

  it("never displaces a past task that the moved task overlaps", () => {
    // Move target T onto 09:00, where a past task P already sits. P is frozen:
    // it is not evicted, not re-placed, and is absent from the output.
    const tasks = [
      task({ id: "T", scheduledStartTime: new Date("2026-06-08T13:00:00Z") }),
      task({ id: "P", scheduledStartTime: new Date("2026-06-08T09:00:00Z") }),
    ];
    const out = cascadeReschedule(
      prefs,
      tasks,
      "T",
      new Date("2026-06-08T09:00:00Z"),
      NOON,
    );
    // P never moves, so it isn't in the changed set.
    expect(out.find((p) => p.id === "P")).toBeUndefined();
    // T lands where requested (the past block doesn't block or evict).
    expect(iso(out.find((p) => p.id === "T")!.scheduledStartTime)).toBe(
      "2026-06-08T09:00:00.000Z",
    );
  });
});

describe("cascadeReschedule", () => {
  it("evicts and re-places a displaced flexible task", () => {
    const tasks = [
      task({ id: "T", scheduledStartTime: new Date("2026-06-08T09:00:00Z") }),
      task({ id: "O", scheduledStartTime: new Date("2026-06-08T10:00:00Z") }),
    ];
    const out = cascadeReschedule(
      prefs,
      tasks,
      "T",
      new Date("2026-06-08T10:00:00Z"),
      MON_MIDNIGHT,
    );
    const byId = (id: string) => out.find((p) => p.id === id);
    expect(iso(byId("T")!.scheduledStartTime)).toBe("2026-06-08T10:00:00.000Z");
    expect(iso(byId("O")!.scheduledStartTime)).toBe("2026-06-08T11:00:00.000Z");
  });

  it("routes the incoming task forward when it lands on a fixed anchor", () => {
    const tasks = [
      task({ id: "T", scheduledStartTime: new Date("2026-06-08T09:00:00Z") }),
      task({
        id: "F",
        fixed: true,
        scheduledStartTime: new Date("2026-06-08T11:00:00Z"),
      }),
    ];
    const out = cascadeReschedule(
      prefs,
      tasks,
      "T",
      new Date("2026-06-08T11:00:00Z"),
      MON_MIDNIGHT,
    );
    // T can't evict the fixed anchor at 11:00, so it goes to the next open slot.
    expect(iso(out.find((p) => p.id === "T")!.scheduledStartTime)).toBe(
      "2026-06-08T12:00:00.000Z",
    );
  });
});
