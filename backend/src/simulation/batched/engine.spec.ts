import { preferenceIndex } from "../../scheduler/slot";
import type { SchedulerPrefs } from "../../scheduler/edf";
import { PersonaState } from "./engine";

/**
 * The batched engine reproduces the production task lifecycle in memory, so these
 * assert the telemetry it emits matches what the services would write: the event
 * stream per operation, the signed preferenceMatrix deltas (MOVE ±1 / KEEP +1),
 * and the abandon sweep. The hard sub-logic (snapshots, matrix math, EDF) is the
 * SAME shared pure code the services use; this guards the orchestration around it.
 */

const PREFS: SchedulerPrefs = {
  workStart: 540, // 09:00
  workEnd: 1020, // 17:00
  workDays: [1, 2, 3, 4, 5],
  timezone: "UTC",
};

// 2025-01-06 is a Monday.
// With 3-hour buckets: 09:00/10:00/11:00 all → bucket 3 (09–12), 12:00 → bucket 4 (12–15).
const MON = "2025-01-06";
const at = (hhmm: string) => new Date(`${MON}T${hhmm}:00.000Z`);
const MON_0900 = preferenceIndex(at("09:00"), "UTC"); // bucket 3
const MON_1200 = preferenceIndex(at("12:00"), "UTC"); // bucket 4
const MON_1100 = preferenceIndex(at("11:00"), "UTC"); // bucket 3

const baseInput = {
  title: "t",
  durationMinutes: 60,
  deadline: null as string | null,
  tags: ["backend"],
  view: "day" as const,
  startDate: MON,
  fixed: false,
};

describe("PersonaState (batched engine)", () => {
  it("CREATE places the task at the earliest feasible slot and logs CREATE", () => {
    const s = new PersonaState("u1", PREFS, ["backend"]);
    const res = s.create({ ...baseInput }, at("09:00"));
    expect(res.placedAt?.toISOString()).toBe(at("09:00").toISOString());
    expect(s.events.map((e) => e.eventType)).toEqual(["CREATE"]);
    expect(s.events[0].oldSnapshot).toBeNull();
  });

  it("MOVE emits a suggested-slot snapshot and applies the signed ±1 matrix", () => {
    const s = new PersonaState("u1", PREFS, ["backend"]);
    const { taskId } = s.create({ ...baseInput }, at("09:00"));
    // Move from 09:00 (bucket 3) to 12:00 (bucket 4) so the ±1 deltas land on
    // distinct matrix cells — same-bucket moves net to zero.
    s.reschedule(taskId, at("12:00"), at("09:05"));

    const move = s.events.find((e) => e.eventType === "MOVE")!;
    const snap = move.newSnapshot as Record<string, unknown>;
    expect(snap.suggestedStartTime).toBe(at("09:00").toISOString());
    expect(snap.scheduledStartTime).toBe(at("12:00").toISOString());
    // +1 at the destination bucket (12–15 = index 4), −1 at the vacated bucket (09–12 = index 3).
    expect(s.matrix[MON_1200]).toBe(1);
    expect(s.matrix[MON_0900]).toBe(-1);
  });

  it("a moved task completes with NO KEEP; an untouched one emits KEEP +1", () => {
    const s = new PersonaState("u1", PREFS, ["backend"]);

    // Moved task → COMPLETE only.
    const a = s.create({ ...baseInput }, at("09:00"));
    s.reschedule(a.taskId, at("10:00"), at("09:05"));
    s.resize(a.taskId, at("10:00"), 90, at("09:06"));
    s.complete(a.taskId, at("11:30"));

    // Untouched task → COMPLETE + KEEP (+1 at its slot).
    const b = s.create({ ...baseInput }, at("11:00"));
    expect(b.placedAt?.toISOString()).toBe(at("11:00").toISOString());
    s.complete(b.taskId, at("12:00"));

    const types = s.events.map((e) => e.eventType);
    expect(types).toEqual([
      "CREATE", // a
      "MOVE",
      "RESIZE",
      "COMPLETE", // a completed (moved → no KEEP)
      "CREATE", // b
      "COMPLETE", // b
      "KEEP", // b kept in suggested slot
    ]);
    expect(s.matrix[MON_1100]).toBe(1);
  });

  it("sweep ABANDONs an overdue, deadline-bearing PENDING task", () => {
    const s = new PersonaState("u1", PREFS, ["backend"]);
    // Deadline already in the past → created unplaced, then swept.
    const { taskId, placedAt } = s.create(
      { ...baseInput, deadline: "2025-01-05T17:00:00.000Z" },
      at("12:00"),
    );
    expect(placedAt).toBeNull();
    s.sweep(at("13:00")); // cutoff = 12:00 (1h grace) > the past deadline

    const types = s.events.map((e) => e.eventType);
    expect(types).toEqual(["CREATE", "ABANDON"]);
    const abandoned = s.tasks.find((t) => t.id === taskId)!;
    expect(abandoned.status).toBe("ABANDONED");
  });

  it("does not abandon deadline-less tasks", () => {
    const s = new PersonaState("u1", PREFS, ["backend"]);
    const { taskId } = s.create({ ...baseInput }, at("09:00"));
    s.sweep(at("23:00"));
    expect(s.events.some((e) => e.eventType === "ABANDON")).toBe(false);
    expect(s.tasks.find((t) => t.id === taskId)!.status).toBe("PENDING");
  });
});

describe("PersonaState duration-bias mode (Step-8 --duration-bias)", () => {
  // Seed telemetry so two tags have very different observed biases, then create a
  // task carrying BOTH and read its corrected duration: blend averages the two,
  // max takes the larger — so the max arm reserves a strictly longer block.
  // 'lo' resizes 60→60 (ratio 1.0); 'hi' resizes 60→120 (ratio 2.0).
  const seedBiasTelemetry = (s: PersonaState): void => {
    const lo = s.create(
      { ...baseInput, tags: ["lo"], durationMinutes: 60 },
      at("09:00"),
    );
    s.resize(lo.taskId, at("09:00"), 60, at("09:05")); // ratio 1.0
    const hi = s.create(
      { ...baseInput, tags: ["hi"], durationMinutes: 60 },
      at("10:00"),
    );
    s.resize(hi.taskId, at("10:00"), 120, at("10:05")); // ratio 2.0
  };

  it("phase2 + blend averages the two tag biases (the default)", () => {
    const s = new PersonaState("u1", PREFS, ["lo", "hi"], "phase2", "blend");
    seedBiasTelemetry(s);
    // Both tags n=1: blend = (1.0 + 2.0)/2 = 1.5 → 60 × 1.5 = 90.
    const t = s.create(
      { ...baseInput, tags: ["lo", "hi"], durationMinutes: 60 },
      at("11:00"),
    );
    expect(s.tasks.find((x) => x.id === t.taskId)!.durationMinutes).toBe(90);
  });

  it("phase2 + max takes the largest tag bias (over-reserves vs blend)", () => {
    const s = new PersonaState("u1", PREFS, ["lo", "hi"], "phase2", "max");
    seedBiasTelemetry(s);
    // max = 2.0 → 60 × 2.0 = 120, strictly longer than the blend's 90.
    const t = s.create(
      { ...baseInput, tags: ["lo", "hi"], durationMinutes: 60 },
      at("11:00"),
    );
    expect(s.tasks.find((x) => x.id === t.taskId)!.durationMinutes).toBe(120);
  });

  it("defaults to blend when the mode arg is omitted (byte-for-byte unchanged)", () => {
    const withDefault = new PersonaState("u1", PREFS, ["lo", "hi"], "phase2");
    const withBlend = new PersonaState(
      "u1",
      PREFS,
      ["lo", "hi"],
      "phase2",
      "blend",
    );
    seedBiasTelemetry(withDefault);
    seedBiasTelemetry(withBlend);
    const a = withDefault.create(
      { ...baseInput, tags: ["lo", "hi"], durationMinutes: 60 },
      at("11:00"),
    );
    const b = withBlend.create(
      { ...baseInput, tags: ["lo", "hi"], durationMinutes: 60 },
      at("11:00"),
    );
    expect(
      withDefault.tasks.find((x) => x.id === a.taskId)!.durationMinutes,
    ).toBe(withBlend.tasks.find((x) => x.id === b.taskId)!.durationMinutes);
  });
});
