import {
  cascadeReschedule,
  type EdfTask,
  findSlot,
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
  ...over,
});

const iso = (d: Date | null) => (d ? d.toISOString() : null);

describe("findSlot", () => {
  it("places at work start on an empty day", () => {
    const slot = findSlot(prefs, 60, null, [], MON_MIDNIGHT);
    expect(iso(slot)).toBe("2026-06-08T09:00:00.000Z");
  });

  it("clamps to now and snaps up to the next 15-min slot", () => {
    const slot = findSlot(prefs, 60, null, [], new Date("2026-06-08T09:40:00Z"));
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
    const slot = findSlot(prefs, 60, null, [], new Date("2026-06-12T16:30:00Z"));
    expect(iso(slot)).toBe("2026-06-15T09:00:00.000Z");
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
      [task({ id: "x", durationMinutes: 120, deadline: new Date("2026-06-08T10:00:00Z") })],
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
