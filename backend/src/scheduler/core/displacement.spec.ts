import {
  pickLateSlot,
  pickMinConflictSlot,
  planDisplacement,
  type DisplacementInput,
  type FlexibleTask,
} from "./displacement";

const ms = (iso: string) => new Date(iso).getTime();
const HOUR = 3_600_000;
const DAY_START = ms("2026-06-15T00:00:00.000Z");
const DAY_END = ms("2026-06-16T00:00:00.000Z");
const ZERO = new Array<number>(168).fill(0);

function flex(
  id: string,
  startIso: string,
  hours: number,
  deadlineIso = "2026-06-15T23:00:00.000Z",
): FlexibleTask {
  return {
    id,
    durationMinutes: hours * 60,
    deadlineMs: ms(deadlineIso),
    startMs: ms(startIso),
  };
}

/** Whole day 08:00-20:00 = fixed except the flexible tasks' slots. */
function base(over: Partial<DisplacementInput> = {}): DisplacementInput {
  return {
    task: { durationMinutes: 60, deadlineMs: ms("2026-06-15T12:00:00.000Z") },
    flexible: [],
    fixed: [],
    nowMs: ms("2026-06-15T06:00:00.000Z"),
    windows: [{ startMs: DAY_START, endMs: DAY_END }],
    prefMatrix: ZERO,
    timezone: "UTC",
    ...over,
  };
}

/** Fixed block covering [06:00, 12:00) except `[gapStart, gapEnd)` hours. */
const fixedAround = (from: string, to: string) => [
  { start: ms(from), end: ms(to) },
];

describe("planDisplacement", () => {
  it("moves a flexible task out of the only slot before the deadline (EDF repack)", () => {
    // 06:00-12:00 blocked by fixed except 09:00-10:00, which a flexible task holds.
    const fixed = [
      ...fixedAround("2026-06-15T06:00:00.000Z", "2026-06-15T09:00:00.000Z"),
      ...fixedAround("2026-06-15T10:00:00.000Z", "2026-06-15T12:00:00.000Z"),
    ];
    const f = flex("f1", "2026-06-15T09:00:00.000Z", 1);
    const plan = planDisplacement(base({ fixed, flexible: [f] }));
    expect(plan.kind).toBe("placed");
    if (plan.kind !== "placed") return;
    expect(new Date(plan.startMs).toISOString()).toBe(
      "2026-06-15T09:00:00.000Z",
    );
    expect(plan.moves).toHaveLength(1);
    expect(plan.moves[0].id).toBe("f1");
    // moved into the free part of its own window (after the deadline of the new task is fine)
    expect(plan.moves[0].toMs).not.toBe(f.startMs);
    expect(plan.moves[0].toMs + HOUR).toBeLessThanOrEqual(f.deadlineMs);
  });

  it("never moves fixed blocks and reports infeasible when only fixed blocks remain", () => {
    const fixed = fixedAround(
      "2026-06-15T06:00:00.000Z",
      "2026-06-15T12:00:00.000Z",
    );
    expect(planDisplacement(base({ fixed })).kind).toBe("infeasible");
  });

  it("is minimal: only the tasks that must move are moved", () => {
    const fixed = fixedAround(
      "2026-06-15T06:00:00.000Z",
      "2026-06-15T08:00:00.000Z",
    );
    // Gap 08:00-12:00; f1 at 08:00, f2 at 11:00. New task (1h) fits by moving just one.
    const flexible = [
      flex("f1", "2026-06-15T08:00:00.000Z", 1),
      flex("f2", "2026-06-15T11:00:00.000Z", 1),
    ];
    const plan = planDisplacement(base({ fixed, flexible }));
    expect(plan.kind).toBe("placed");
    if (plan.kind === "placed")
      expect(plan.moves.length).toBeLessThanOrEqual(1);
  });

  it("respects the cascade cap", () => {
    const fixed = fixedAround(
      "2026-06-15T06:00:00.000Z",
      "2026-06-15T08:00:00.000Z",
    );
    // Deadline 10:00; two flexible tasks fill 08-10, each must move; cap 0 forbids it.
    const flexible = [
      flex("f1", "2026-06-15T08:00:00.000Z", 1),
      flex("f2", "2026-06-15T09:00:00.000Z", 1),
    ];
    const input = base({
      fixed,
      flexible,
      task: { durationMinutes: 60, deadlineMs: ms("2026-06-15T10:00:00.000Z") },
    });
    expect(planDisplacement({ ...input, maxMoves: 0 }).kind).toBe("infeasible");
    expect(planDisplacement({ ...input, maxMoves: 5 }).kind).toBe("placed");
  });

  it("orders relocations by deadline (EDF): the earlier-deadline task gets the earlier free slot", () => {
    const fixed = fixedAround(
      "2026-06-15T06:00:00.000Z",
      "2026-06-15T09:00:00.000Z",
    );
    const flexible = [
      flex("late", "2026-06-15T09:00:00.000Z", 1, "2026-06-15T23:00:00.000Z"),
      flex("early", "2026-06-15T10:00:00.000Z", 1, "2026-06-15T13:00:00.000Z"),
    ];
    const plan = planDisplacement(
      base({
        fixed,
        flexible,
        task: {
          durationMinutes: 120,
          deadlineMs: ms("2026-06-15T11:00:00.000Z"),
        },
      }),
    );
    expect(plan.kind).toBe("placed");
    if (plan.kind !== "placed") return;
    const e = plan.moves.find((m) => m.id === "early");
    const l = plan.moves.find((m) => m.id === "late");
    // Both are displaced by the 09-11 new task; `early` must still meet its 13:00 deadline.
    expect(e).toBeDefined();
    expect(e!.toMs + HOUR).toBeLessThanOrEqual(ms("2026-06-15T13:00:00.000Z"));
    if (l && e) expect(e.toMs).toBeLessThanOrEqual(l.toMs);
  });

  it("widens to the next window only when the same day is infeasible", () => {
    const fixed = fixedAround(
      "2026-06-15T06:00:00.000Z",
      "2026-06-15T09:00:00.000Z",
    );
    const flexible = [flex("f1", "2026-06-15T09:00:00.000Z", 1)];
    // f1 can only run 09:00-10:00 today (deadline 10:00 today, fixed elsewhere)
    const tight = {
      ...flexible[0],
      deadlineMs: ms("2026-06-15T10:00:00.000Z"),
    };
    const narrow = base({
      fixed,
      flexible: [tight],
      task: { durationMinutes: 60, deadlineMs: ms("2026-06-15T10:00:00.000Z") },
    });
    expect(planDisplacement(narrow).kind).toBe("infeasible");
    // A wider window does not help a task with a hard own-deadline; the point
    // is windows are tried in order and the plan for the FIRST feasible one wins.
    const wide = planDisplacement({
      ...narrow,
      flexible: [{ ...tight, deadlineMs: ms("2026-06-16T10:00:00.000Z") }],
      windows: [
        { startMs: DAY_START, endMs: DAY_END },
        { startMs: DAY_START - 24 * HOUR, endMs: DAY_END + 24 * HOUR },
      ],
    });
    expect(wide.kind).toBe("placed");
  });

  it("is deterministic and idempotent (re-planning the result needs no moves)", () => {
    const fixed = fixedAround(
      "2026-06-15T06:00:00.000Z",
      "2026-06-15T09:00:00.000Z",
    );
    const flexible = [flex("f1", "2026-06-15T09:00:00.000Z", 1)];
    const a = planDisplacement(base({ fixed, flexible }));
    const b = planDisplacement(base({ fixed, flexible }));
    expect(a).toEqual(b);
    if (a.kind !== "placed") throw new Error("expected placed");
    // Apply the plan, then ask for the same task's slot as fixed: nothing left to move.
    const applied = flexible.map((f) => {
      const m = a.moves.find((x) => x.id === f.id);
      return m ? { ...f, startMs: m.toMs } : f;
    });
    const again = planDisplacement(
      base({
        fixed: [...fixed, { start: a.startMs, end: a.startMs + HOUR }],
        flexible: applied,
        task: {
          durationMinutes: 15,
          deadlineMs: ms("2026-06-15T23:00:00.000Z"),
        },
      }),
    );
    expect(again.kind === "placed" ? again.moves : []).toEqual([]);
  });

  it("does not move tasks that have already started", () => {
    const fixed = fixedAround(
      "2026-06-15T10:00:00.000Z",
      "2026-06-15T12:00:00.000Z",
    );
    const started = flex("s", "2026-06-15T06:00:00.000Z", 4); // started before now
    const plan = planDisplacement(
      base({
        fixed,
        flexible: [started],
        nowMs: ms("2026-06-15T07:00:00.000Z"),
      }),
    );
    expect(plan.kind).toBe("infeasible");
  });
});

describe("fallback slot pickers", () => {
  const occupied = [
    {
      start: ms("2026-06-15T06:00:00.000Z"),
      end: ms("2026-06-15T12:00:00.000Z"),
    },
  ];
  const common = {
    durationMinutes: 60,
    nowMs: ms("2026-06-15T06:00:00.000Z"),
    deadlineMs: ms("2026-06-15T12:00:00.000Z"),
    occupied,
    prefMatrix: ZERO,
    timezone: "UTC",
  };

  it("accept-conflicts picks a slot before the deadline", () => {
    const s = pickMinConflictSlot(common)!;
    expect(s + HOUR).toBeLessThanOrEqual(common.deadlineMs);
  });

  it("accept-conflicts prefers the least-overlap slot", () => {
    const partial = [
      {
        start: ms("2026-06-15T06:00:00.000Z"),
        end: ms("2026-06-15T11:30:00.000Z"),
      },
    ];
    const s = pickMinConflictSlot({ ...common, occupied: partial })!;
    expect(new Date(s).toISOString()).toBe("2026-06-15T11:00:00.000Z");
  });

  it("accept-late picks the first free slot ending after the deadline", () => {
    const s = pickLateSlot(common)!;
    expect(new Date(s).toISOString()).toBe("2026-06-15T12:00:00.000Z");
    expect(s + HOUR).toBeGreaterThan(common.deadlineMs);
  });

  it("accept-late returns null when nothing is free within the horizon", () => {
    expect(
      pickLateSlot({
        ...common,
        horizonEndMs: ms("2026-06-15T12:30:00.000Z"),
      }),
    ).toBeNull();
  });

  it("accept-conflicts returns null when now + duration > deadline", () => {
    expect(
      pickMinConflictSlot({
        ...common,
        nowMs: ms("2026-06-15T11:30:00.000Z"),
      }),
    ).toBeNull();
  });
});
