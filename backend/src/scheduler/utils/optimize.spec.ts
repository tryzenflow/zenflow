import { PREFERENCE_MATRIX_LENGTH } from "@zenflow/shared";
import { repackWindow, selectCandidates, type OptimizeMode } from "./optimize";
import type { EdfTask, SchedulerPrefs } from "../interfaces";
import { addDaysStr, preferenceIndex, type Interval } from "./slot";

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

describe("selectCandidates", () => {
  it("mode 'full': every task is movable, nothing is fixed", () => {
    const tasks = [
      task({ id: "a", manuallyMoved: true }),
      task({ id: "b", manuallyMoved: false }),
    ];
    const { movable, fixed } = selectCandidates(tasks, "full");
    expect(movable.map((t) => t.id).sort()).toEqual(["a", "b"]);
    expect(fixed).toEqual([]);
  });

  it("mode 'balanced': every task is movable, nothing is fixed — same split as 'full'", () => {
    const tasks = [
      task({ id: "a", manuallyMoved: true }),
      task({ id: "b", manuallyMoved: false }),
    ];
    const { movable, fixed } = selectCandidates(tasks, "balanced");
    expect(movable.map((t) => t.id).sort()).toEqual(["a", "b"]);
    expect(fixed).toEqual([]);
  });

  it("mode 'retainManual': manuallyMoved tasks are fixed, everything else movable", () => {
    const tasks = [
      task({ id: "a", manuallyMoved: true }),
      task({ id: "b", manuallyMoved: false }),
    ];
    const { movable, fixed } = selectCandidates(tasks, "retainManual");
    expect(movable.map((t) => t.id)).toEqual(["b"]);
    expect(fixed.map((t) => t.id)).toEqual(["a"]);
  });

  it("mode 'retainManual': a manually-moved task is fixed EVEN IF it's currently conflicting/invalid", () => {
    const tasks = [
      task({ id: "a", manuallyMoved: true, conflict: true }),
      task({ id: "b", manuallyMoved: false }),
    ];
    const { fixed } = selectCandidates(tasks, "retainManual");
    expect(fixed.map((t) => t.id)).toEqual(["a"]);
  });
});

describe("repackWindow", () => {
  it("places movable tasks in EDF order against the seeded occupied set", () => {
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
    const placements = repackWindow(
      { movable: [loose, tight], fixed: [] },
      [],
      now,
      prefs,
      [],
      "full",
    );
    const tightP = placements.find((p) => p.id === "tight")!;
    const looseP = placements.find((p) => p.id === "loose")!;
    expect(new Date(tightP.interval!.start).toISOString()).toBe(
      at("09:00").toISOString(),
    );
    expect(new Date(looseP.interval!.start).toISOString()).toBe(
      at("09:30").toISOString(),
    );
  });

  it("never repositions a fixed task, and routes movable tasks around its occupied slot", () => {
    const now = at("08:00");
    const fixed = task({
      id: "fixed",
      manuallyMoved: true,
      scheduledStartTime: at("09:00"),
      durationMinutes: 60,
    });
    const movable = task({
      id: "movable",
      deadline: at("17:00"),
      durationMinutes: 60,
      createdAt: at("00:01"),
    });
    const placements = repackWindow(
      { movable: [movable], fixed: [fixed] },
      [],
      now,
      prefs,
      [],
      "retainManual",
    );
    // The fixed task never appears in the movable results at all.
    expect(placements.map((p) => p.id)).toEqual(["movable"]);
    expect(new Date(placements[0].interval!.start).toISOString()).toBe(
      at("10:00").toISOString(), // routed around fixed's 09:00-10:00
    );
  });

  it("seeds occupied space from fixedOccupied (outside-the-window tasks)", () => {
    const now = at("08:00");
    const movable = task({
      id: "a",
      deadline: at("17:00"),
      durationMinutes: 60,
    });
    const outside: Interval = {
      start: at("09:00").getTime(),
      end: at("10:00").getTime(),
    };
    const placements = repackWindow(
      { movable: [movable], fixed: [] },
      [outside],
      now,
      prefs,
      [],
      "full",
    );
    expect(new Date(placements[0].interval!.start).toISOString()).toBe(
      at("10:00").toISOString(),
    );
  });

  describe("no cross-task cost comparison — two movable tasks never affect each other's chosen slot beyond occupying space", () => {
    it("mode 'full': each task lands at its own cheapest/earliest slot; the only interaction is occupied-space routing", () => {
      const now = at("08:00");
      const a = task({
        id: "a",
        deadline: at("17:00"),
        durationMinutes: 60,
        createdAt: at("00:01"),
      });
      const b = task({
        id: "b",
        deadline: at("17:00", 1),
        durationMinutes: 60,
        createdAt: at("00:02"),
      });
      const placements = repackWindow(
        { movable: [a, b], fixed: [] },
        [],
        now,
        prefs,
        [],
        "full",
      );
      const aP = placements.find((p) => p.id === "a")!;
      const bP = placements.find((p) => p.id === "b")!;
      // "a" (earlier deadline) claims the earliest slot; "b" simply finds ITS
      // own next slot once "a"'s occupies space — neither's placement was
      // chosen by weighing the other's cost.
      expect(new Date(aP.interval!.start).toISOString()).toBe(
        at("09:00").toISOString(),
      );
      expect(new Date(bP.interval!.start).toISOString()).toBe(
        at("10:00").toISOString(),
      );
    });
  });

  describe("mode 'balanced' — Mode-3 proximity bias, scoped to a task's OWN candidates only", () => {
    it("a near-term task's own candidate favors staying close to its current slot over a merely-liked-but-far slot", () => {
      const now = at("08:00");
      // Anchored 1 hour from now (near-term — full proximity weight).
      const nearTask = task({
        id: "near",
        scheduledStartTime: at("09:00"),
        deadline: at("17:00"),
        durationMinutes: 60,
      });
      // A distant liked slot (15:00) that a pure preference-only ranker would
      // pick over the near anchor, absent any proximity bias.
      const matrix = new Array<number>(PREFERENCE_MATRIX_LENGTH).fill(0);
      matrix[preferenceIndex(at("15:00"), prefs.timezone)] = 1; // mild preference

      const placements = repackWindow(
        { movable: [nearTask], fixed: [] },
        [],
        now,
        prefs,
        matrix,
        "balanced",
      );
      // The proximity penalty for moving 6 hours away from a near-term anchor
      // (weight ≈ 1.0/min) dwarfs a mild +1 preference bonus, so the task
      // stays put.
      expect(new Date(placements[0].interval!.start).toISOString()).toBe(
        at("09:00").toISOString(),
      );
    });

    it("a far-term task's own candidate is NOT resistant to moving toward a liked slot", () => {
      const now = at("08:00");
      // Anchored 10 days out — well beyond the Mode-3 proximity horizon, so
      // its resistance-to-moving weight bottoms out near-zero.
      const farTask = task({
        id: "far",
        scheduledStartTime: at("09:00", 10),
        deadline: at("17:00", 10),
        durationMinutes: 60,
      });
      // Strong enough to outweigh even the FAR (0.1/min) proximity penalty
      // over the 6-hour gap to its own anchor (360 * 0.1 = 36).
      const matrix = new Array<number>(PREFERENCE_MATRIX_LENGTH).fill(0);
      matrix[preferenceIndex(at("15:00", 10), prefs.timezone)] = 50;

      const placements = repackWindow(
        { movable: [farTask], fixed: [] },
        [],
        now,
        prefs,
        matrix,
        "balanced",
      );
      expect(new Date(placements[0].interval!.start).getUTCHours()).toBe(15);
    });

    it("never becomes a cross-task comparison: two independently-movable tasks in mode 'balanced' still only interact via occupied space", () => {
      const now = at("08:00");
      const a = task({
        id: "a",
        scheduledStartTime: at("09:00"),
        deadline: at("17:00"),
        durationMinutes: 60,
        createdAt: at("00:01"),
      });
      const b = task({
        id: "b",
        scheduledStartTime: at("10:00"),
        deadline: at("17:00"),
        durationMinutes: 60,
        createdAt: at("00:02"),
      });
      const placements = repackWindow(
        { movable: [a, b], fixed: [] },
        [],
        now,
        prefs,
        [],
        "balanced",
      );
      // Both tasks are cost-stable at their own current anchors (zero
      // proximity penalty for staying, no preference signal) — neither one's
      // presence changes what the OTHER'S own candidate scoring looks like,
      // only whether a given slot is free.
      const aP = placements.find((p) => p.id === "a")!;
      const bP = placements.find((p) => p.id === "b")!;
      expect(new Date(aP.interval!.start).toISOString()).toBe(
        at("09:00").toISOString(),
      );
      expect(new Date(bP.interval!.start).toISOString()).toBe(
        at("10:00").toISOString(),
      );
    });
  });

  describe("determinism across modes", () => {
    it.each<OptimizeMode>(["full", "retainManual", "balanced"])(
      "mode %s: identical inputs yield identical output",
      (mode) => {
        const now = at("08:00");
        const a = task({
          id: "a",
          deadline: at("17:00"),
          durationMinutes: 60,
        });
        const run = () =>
          repackWindow(
            { movable: [{ ...a }], fixed: [] },
            [],
            new Date(now.getTime()),
            prefs,
            [],
            mode,
          );
        expect(run()).toEqual(run());
      },
    );
  });
});
