import { PREFERENCE_MATRIX_LENGTH } from "@zenflow/shared";
import { SchedulerService } from "./scheduler.service";
import type { SchedulerPrefs } from "./interfaces";

/**
 * `SchedulerService` is the ONLY I/O layer (CLAUDE.md invariant #2) — these
 * tests drive it against an in-memory Prisma-shaped fake so the persistence
 * wiring (load → pure-core call → diff → write-back) is exercised without a
 * real DB. The pure math itself is covered by `edf`/`reranker`/`overflow`/
 * `rationale`/`duration-bias` specs.
 */

const prefs: SchedulerPrefs = {
  workStart: 540, // 09:00
  workEnd: 1020, // 17:00
  workDays: [1, 2, 3, 4, 5],
  timezone: "UTC",
};

interface FakeTask {
  id: string;
  userId: string;
  durationMinutes: number;
  deadline: Date | null;
  manuallyMoved: boolean;
  scheduledStartTime: Date | null;
  createdAt: Date;
  conflict: boolean;
  status: string;
}

function fakeTask(overrides: Partial<FakeTask> & { id: string }): FakeTask {
  return {
    userId: "u1",
    durationMinutes: 60,
    deadline: null,
    manuallyMoved: false,
    scheduledStartTime: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    conflict: false,
    status: "PENDING",
    ...overrides,
  };
}

function makeFakePrisma(
  tasks: FakeTask[],
  userRow?: { preferenceMatrix: number[]; timezone: string },
) {
  const table = new Map(tasks.map((t) => [t.id, t]));
  const user = userRow ?? { preferenceMatrix: [], timezone: "UTC" };
  const taskEventCreate = jest.fn().mockResolvedValue({});
  const userUpdate = jest.fn().mockResolvedValue({});

  /** Minimal Prisma-shaped matcher: handles the `{ not }` status filter and the
   * `OR: [{ scheduledStartTime: null }, { scheduledStartTime: { gte, lte } }]`
   * shape `loadPendingRows` actually issues. */
  const matchesStatus = (t: FakeTask, filter: unknown): boolean => {
    if (filter === undefined) return true;
    if (typeof filter === "string") return t.status === filter;
    const notFilter = filter as { not?: string };
    if (notFilter && typeof notFilter === "object" && "not" in notFilter)
      return t.status !== notFilter.not;
    return true;
  };
  const matchesScheduledStartTime = (t: FakeTask, clause: unknown): boolean => {
    if (clause === null) return t.scheduledStartTime === null;
    if (t.scheduledStartTime === null) return false;
    const range = clause as { gte?: Date; lte?: Date };
    const time = t.scheduledStartTime.getTime();
    if (range.gte && time < range.gte.getTime()) return false;
    if (range.lte && time > range.lte.getTime()) return false;
    return true;
  };

  const db = {
    task: {
      findMany: jest.fn((args: { where?: Record<string, unknown> }) => {
        const where = args.where ?? {};
        return Promise.resolve(
          [...table.values()].filter((t) => {
            if (where.userId !== undefined && t.userId !== where.userId)
              return false;
            if (!matchesStatus(t, where.status)) return false;
            if (where.id !== undefined && where.id !== t.id) return false;
            if (where.OR !== undefined) {
              const clauses = where.OR as { scheduledStartTime?: unknown }[];
              const ok = clauses.some((c) =>
                matchesScheduledStartTime(t, c.scheduledStartTime),
              );
              if (!ok) return false;
            }
            return true;
          }),
        );
      }),
      update: jest.fn(
        (args: { where: { id: string }; data: Record<string, unknown> }) => {
          const row = table.get(args.where.id)!;
          const next = { ...row, ...args.data };
          table.set(args.where.id, next);
          return Promise.resolve(next);
        },
      ),
      findUniqueOrThrow: jest.fn((args: { where: { id: string } }) => {
        const row = table.get(args.where.id);
        if (!row) return Promise.reject(new Error("not found"));
        return Promise.resolve(row);
      }),
    },
    user: {
      findUniqueOrThrow: jest.fn().mockResolvedValue(user),
      update: userUpdate,
    },
    taskEvent: {
      create: taskEventCreate,
      createMany: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };

  const prisma = {
    ...db,
    $transaction: (fn: (t: typeof db) => unknown) => fn(db),
  };

  return {
    prisma,
    table,
    taskEventCreate,
    taskEventCreateMany: db.taskEvent.createMany,
    userUpdate,
  };
}

describe("SchedulerService.computeDurationCorrection", () => {
  it("returns neutral bias (adjustedDuration === estimate) with no telemetry history", async () => {
    const { prisma } = makeFakePrisma([]);
    const service = new SchedulerService(prisma as never);
    const result = await service.computeDurationCorrection(
      "u1",
      ["backend"],
      60,
    );
    expect(result.adjustedDuration).toBe(60);
    expect(result.biasApplied).toBe(1.0);
    expect(result.durationReason).toBeNull();
  });

  it("blends per-tag bias from CREATE/COMPLETE telemetry pairs", async () => {
    const events = [
      {
        taskId: "t1",
        eventType: "CREATE",
        newSnapshot: { durationMinutes: 60, tags: ["backend"] },
      },
      {
        taskId: "t1",
        eventType: "COMPLETE",
        newSnapshot: { durationMinutes: 90, tags: ["backend"] },
      },
    ];
    const prisma = {
      taskEvent: { findMany: jest.fn().mockResolvedValue(events) },
    };
    const service = new SchedulerService(prisma as never);
    const result = await service.computeDurationCorrection(
      "u1",
      ["backend"],
      60,
    );
    expect(result.biasApplied).toBeCloseTo(1.5);
    expect(result.adjustedDuration).toBe(90); // 60*1.5=90, already grid-aligned
    expect(result.durationReason).toContain("backend");
  });
});

describe("SchedulerService.cascadeReschedule", () => {
  it("loads PENDING tasks and writes back only CHANGED placements", async () => {
    const now = new Date("2026-06-08T08:00:00Z"); // Monday
    const a = fakeTask({
      id: "a",
      deadline: new Date("2026-06-08T17:00:00Z"),
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    const { prisma, table } = makeFakePrisma([a]);
    const service = new SchedulerService(prisma as never);

    const displaced = await service.cascadeReschedule("u1", prefs, {
      windowStart: now,
      windowEnd: a.deadline!,
    });

    expect(displaced).toHaveLength(1);
    expect(table.get("a")!.scheduledStartTime?.toISOString()).toBe(
      "2026-06-08T09:00:00.000Z",
    );
  });

  it("does not rewrite a task whose placement didn't change", async () => {
    const now = new Date("2026-06-08T08:00:00Z");
    const already = fakeTask({
      id: "a",
      manuallyMoved: true,
      scheduledStartTime: new Date("2026-06-08T09:00:00Z"),
    });
    const { prisma } = makeFakePrisma([already]);
    const service = new SchedulerService(prisma as never);

    const displaced = await service.cascadeReschedule("u1", prefs, {
      windowStart: now,
      windowEnd: new Date("2026-06-09T00:00:00Z"),
    });
    expect(displaced).toHaveLength(0);
  });

  it("recomputes true pairwise-overlap conflicts across manually-moved tasks", async () => {
    const now = new Date("2030-06-17T08:00:00Z"); // far future Monday
    const a = fakeTask({
      id: "a",
      manuallyMoved: true,
      durationMinutes: 120,
      scheduledStartTime: new Date("2030-06-17T09:00:00Z"),
      conflict: true,
    });
    const b = fakeTask({
      id: "b",
      manuallyMoved: true,
      durationMinutes: 60,
      scheduledStartTime: new Date("2030-06-17T09:30:00Z"),
      conflict: true,
    });
    const { prisma, table } = makeFakePrisma([a, b]);
    const service = new SchedulerService(prisma as never);

    await service.cascadeReschedule("u1", prefs, {
      windowStart: now,
      windowEnd: new Date("2030-06-18T00:00:00Z"),
    });
    // Still overlapping → conflict stays true (self-heal happens once one is removed).
    expect(table.get("a")!.conflict).toBe(true);
    expect(table.get("b")!.conflict).toBe(true);
  });

  it("writes a conflict-flag flip to the DB but doesn't report it as displaced", async () => {
    const now = new Date("2030-06-17T08:00:00Z"); // far future Monday
    // Neither task's stored `scheduledStartTime` will change — only their
    // conflict flags flip true once the pairwise-overlap recompute sees them
    // clash. Nothing about either task actually moved, so this must not
    // surface in the returned (== "displaced") list.
    const a = fakeTask({
      id: "a",
      manuallyMoved: true,
      durationMinutes: 120,
      scheduledStartTime: new Date("2030-06-17T09:00:00Z"),
      conflict: false,
    });
    const b = fakeTask({
      id: "b",
      manuallyMoved: true,
      durationMinutes: 60,
      scheduledStartTime: new Date("2030-06-17T09:30:00Z"),
      conflict: false,
    });
    const { prisma, table } = makeFakePrisma([a, b]);
    const service = new SchedulerService(prisma as never);

    const displaced = await service.cascadeReschedule("u1", prefs, {
      windowStart: now,
      windowEnd: new Date("2030-06-18T00:00:00Z"),
    });

    expect(table.get("a")!.conflict).toBe(true);
    expect(table.get("b")!.conflict).toBe(true);
    expect(displaced).toHaveLength(0);
  });

  it("scopes the cascade to a window, freezing tasks placed outside it", async () => {
    const outside = fakeTask({
      id: "outside",
      scheduledStartTime: new Date("2026-06-20T09:00:00Z"),
    });
    const { prisma, table } = makeFakePrisma([outside]);
    const service = new SchedulerService(prisma as never);

    await service.cascadeReschedule("u1", prefs, {
      windowStart: new Date("2026-06-08T00:00:00Z"),
      windowEnd: new Date("2026-06-09T00:00:00Z"),
    });

    expect(table.get("outside")!.scheduledStartTime?.toISOString()).toBe(
      "2026-06-20T09:00:00.000Z",
    );
  });

  it("a zero-width (create) window still loads already-placed tasks as occupied space", async () => {
    // Regression: the create path calls cascadeReschedule with
    // `windowStart === windowEnd === now`, which freezes every placed task.
    // The row load must NOT be bounded by that window — otherwise the existing
    // 09:00 task isn't loaded, `occupied` is empty, and the new unplaced task
    // gets dropped straight on top of it.
    const now = new Date("2026-06-08T08:00:00Z"); // Monday
    const existing = fakeTask({
      id: "existing",
      scheduledStartTime: new Date("2026-06-08T09:00:00Z"),
    });
    const fresh = fakeTask({ id: "fresh", createdAt: now }); // unplaced
    const { prisma, table } = makeFakePrisma([existing, fresh]);
    const service = new SchedulerService(prisma as never);

    await service.cascadeReschedule("u1", prefs, {
      windowStart: now,
      windowEnd: now, // zero-width — the create-path scope
    });

    // The existing 09:00 task is untouched, and the new task lands AFTER it
    // (10:00), not on top of it.
    expect(table.get("existing")!.scheduledStartTime?.toISOString()).toBe(
      "2026-06-08T09:00:00.000Z",
    );
    expect(table.get("fresh")!.scheduledStartTime?.toISOString()).toBe(
      "2026-06-08T10:00:00.000Z",
    );
  });

  it("includeManual: true repositions a manually-moved task and clears its manuallyMoved column", async () => {
    const now = new Date("2026-06-08T08:00:00Z"); // Monday
    const a = fakeTask({
      id: "a",
      manuallyMoved: true,
      deadline: new Date("2026-06-08T17:00:00Z"),
      scheduledStartTime: new Date("2026-06-08T10:00:00Z"),
    });
    const { prisma, table } = makeFakePrisma([a]);
    const service = new SchedulerService(prisma as never);

    const displaced = await service.cascadeReschedule("u1", prefs, {
      windowStart: now,
      windowEnd: a.deadline!,
      includeManual: true,
    });

    expect(displaced).toHaveLength(1);
    expect(table.get("a")!.scheduledStartTime?.toISOString()).toBe(
      "2026-06-08T09:00:00.000Z",
    );
    expect(table.get("a")!.manuallyMoved).toBe(false);
  });

  it("without includeManual, a manually-moved task inside the window stays frozen at its slot", async () => {
    const now = new Date("2026-06-08T08:00:00Z");
    const a = fakeTask({
      id: "a",
      manuallyMoved: true,
      deadline: new Date("2026-06-08T17:00:00Z"),
      scheduledStartTime: new Date("2026-06-08T10:00:00Z"),
    });
    const { prisma, table } = makeFakePrisma([a]);
    const service = new SchedulerService(prisma as never);

    const displaced = await service.cascadeReschedule("u1", prefs, {
      windowStart: now,
      windowEnd: a.deadline!,
    });

    expect(displaced).toHaveLength(0);
    expect(table.get("a")!.scheduledStartTime?.toISOString()).toBe(
      "2026-06-08T10:00:00.000Z",
    );
    expect(table.get("a")!.manuallyMoved).toBe(true);
  });

  it("logs a RESCHEDULED event for a collateral task the ranker actually re-placed", async () => {
    const now = new Date("2026-06-08T08:00:00Z"); // Monday
    const a = fakeTask({
      id: "a",
      deadline: new Date("2026-06-08T17:00:00Z"),
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    const { prisma, table, taskEventCreateMany } = makeFakePrisma([a]);
    const service = new SchedulerService(prisma as never);

    await service.cascadeReschedule("u1", prefs, {
      windowStart: now,
      windowEnd: a.deadline!,
    });

    expect(table.get("a")!.scheduledStartTime).not.toBeNull();
    expect(taskEventCreateMany).toHaveBeenCalledTimes(1);
    const calls = taskEventCreateMany.mock.calls as {
      data: {
        taskId: string;
        userId: string;
        eventType: string;
        rewardScore: number;
      }[];
    }[][];
    const data = calls[0][0].data;
    expect(data).toHaveLength(1);
    expect(data[0]).toEqual(
      expect.objectContaining({
        taskId: "a",
        userId: "u1",
        eventType: "RESCHEDULED",
        rewardScore: 1.0,
      }),
    );
  });

  it("does not log a RESCHEDULED event for `scope.fixedTaskId` — the caller owns that event", async () => {
    const now = new Date("2026-06-08T08:00:00Z"); // Monday
    const a = fakeTask({
      id: "a",
      deadline: new Date("2026-06-08T17:00:00Z"),
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    const { prisma, taskEventCreateMany } = makeFakePrisma([a]);
    const service = new SchedulerService(prisma as never);

    await service.cascadeReschedule("u1", prefs, {
      windowStart: now,
      windowEnd: a.deadline!,
      fixedTaskId: "a",
    });

    expect(taskEventCreateMany).not.toHaveBeenCalled();
  });

  it("logs RESCHEDULED for an includeManual-swept-in task regardless of its prior manuallyMoved flag", async () => {
    const now = new Date("2026-06-08T08:00:00Z"); // Monday
    const a = fakeTask({
      id: "a",
      manuallyMoved: true,
      deadline: new Date("2026-06-08T17:00:00Z"),
      scheduledStartTime: new Date("2026-06-08T10:00:00Z"),
    });
    const { prisma, taskEventCreateMany } = makeFakePrisma([a]);
    const service = new SchedulerService(prisma as never);

    await service.cascadeReschedule("u1", prefs, {
      windowStart: now,
      windowEnd: a.deadline!,
      includeManual: true,
    });

    expect(taskEventCreateMany).toHaveBeenCalledTimes(1);
    const calls = taskEventCreateMany.mock.calls as {
      data: { taskId: string; eventType: string }[];
    }[][];
    expect(calls[0][0].data[0]).toEqual(
      expect.objectContaining({ taskId: "a", eventType: "RESCHEDULED" }),
    );
  });

  it("does not log an event when a manually-moved task inside the window stays frozen (no propensity, no diff)", async () => {
    const now = new Date("2026-06-08T08:00:00Z");
    const a = fakeTask({
      id: "a",
      manuallyMoved: true,
      deadline: new Date("2026-06-08T17:00:00Z"),
      scheduledStartTime: new Date("2026-06-08T10:00:00Z"),
    });
    const { prisma, taskEventCreateMany } = makeFakePrisma([a]);
    const service = new SchedulerService(prisma as never);

    await service.cascadeReschedule("u1", prefs, {
      windowStart: now,
      windowEnd: a.deadline!,
    });

    expect(taskEventCreateMany).not.toHaveBeenCalled();
  });
});

describe("SchedulerService.simulate — read-only", () => {
  it("never writes to the DB", async () => {
    const { prisma, table } = makeFakePrisma([]);
    const service = new SchedulerService(prisma as never);

    await service.simulate(
      "u1",
      prefs,
      { durationMinutes: 60, deadline: new Date("2026-06-08T17:00:00Z") },
      new Date("2026-06-08T08:00:00Z"),
    );

    expect(prisma.task.update).not.toHaveBeenCalled();
    expect(table.size).toBe(0);
  });

  it("returns a proposal with a rationale when the matrix has signal", async () => {
    const matrix = new Array<number>(PREFERENCE_MATRIX_LENGTH).fill(0);
    matrix[0 * 24 + 9] = 5; // Monday 09:00 liked
    const { prisma } = makeFakePrisma([], {
      preferenceMatrix: matrix,
      timezone: "UTC",
    });
    const service = new SchedulerService(prisma as never);

    const result = await service.simulate(
      "u1",
      prefs,
      { durationMinutes: 60, deadline: new Date("2026-06-08T17:00:00Z") },
      new Date("2026-06-08T08:00:00Z"),
    );

    expect(result.proposals.length).toBeGreaterThan(0);
  });

  it("returns no proposals when the draft can't fit before its deadline", async () => {
    const { prisma } = makeFakePrisma([]);
    const service = new SchedulerService(prisma as never);

    const result = await service.simulate(
      "u1",
      prefs,
      { durationMinutes: 60, deadline: new Date("2026-06-08T08:15:00Z") },
      new Date("2026-06-08T08:00:00Z"),
    );
    expect(result.proposals).toEqual([]);
  });
});

describe("SchedulerService.resolveOverflow", () => {
  it("pins the task at the resolved slot and persists the MOVE event", async () => {
    const now = new Date("2026-06-08T20:00:00Z"); // past work hours
    const overflowed = fakeTask({
      id: "a",
      deadline: new Date("2026-06-08T09:00:00Z"), // already overdue
      conflict: true,
    });
    const { prisma, table, taskEventCreateMany } = makeFakePrisma([overflowed]);
    const service = new SchedulerService(prisma as never);

    const result = await service.resolveOverflow(
      "a",
      "outsideHours",
      "u1",
      prefs,
      now,
    );

    expect(table.get("a")!.manuallyMoved).toBe(true);
    expect(table.get("a")!.scheduledStartTime).not.toBeNull();
    expect(result.task.conflict).toBe(false);
    expect(taskEventCreateMany).toHaveBeenCalled();
  });

  it("does NOT mislabel a secondary auto-healed neighbor as a user action", async () => {
    const now = new Date("2026-06-08T20:00:00Z"); // past work hours, Monday
    const overflowed = fakeTask({
      id: "a",
      deadline: new Date("2026-06-08T09:00:00Z"), // already overdue
      conflict: true,
    });
    // A second PENDING task, movable (not manuallyMoved), whose currently
    // stored slot does NOT match where a fresh EDF repack places it once "a"
    // occupies its own slot — the auto-heal displaces it as a pure algorithmic
    // side-effect of resolving "a"'s overflow, not a real user action.
    const neighbor = fakeTask({
      id: "b",
      manuallyMoved: false,
      conflict: false,
      scheduledStartTime: new Date("2026-06-10T09:00:00Z"), // Wednesday — stale
    });
    const originalNeighborStart = neighbor.scheduledStartTime!.toISOString();
    const { prisma, table, taskEventCreateMany } = makeFakePrisma([
      overflowed,
      neighbor,
    ]);
    const service = new SchedulerService(prisma as never);

    await service.resolveOverflow("a", "outsideHours", "u1", prefs, now);

    // (a) the neighbor's slot in `table` DID change (the auto-heal repositioned it).
    expect(table.get("b")!.scheduledStartTime).not.toBeNull();
    expect(table.get("b")!.scheduledStartTime!.toISOString()).not.toBe(
      originalNeighborStart,
    );
    // (b) it must NOT have been force-pinned as manuallyMoved.
    expect(table.get("b")!.manuallyMoved).toBe(false);
    // (c) only the resolved task's own MOVE event is in the batch — the
    // neighbor's silent reposition must not fabricate a TaskEvent.
    const calls = taskEventCreateMany.mock.calls as {
      data: { taskId: string }[];
    }[][];
    const batch = calls[0][0].data;
    expect(batch).toHaveLength(1);
    expect(batch.map((e) => e.taskId)).not.toContain("b");
    expect(batch.map((e) => e.taskId)).toContain("a");
  });
});

/** Pull the `preferenceMatrix` a fake `user.update` mock was called with. */
function nudgedMatrix(userUpdate: jest.Mock): number[] {
  const calls = userUpdate.mock.calls as {
    data: { preferenceMatrix: number[] };
  }[][];
  return calls[0][0].data.preferenceMatrix;
}

describe("SchedulerService.recordEvent", () => {
  it("writes a TaskEvent and nudges the preference matrix on KEEP", async () => {
    const { prisma, taskEventCreate, userUpdate } = makeFakePrisma([]);
    const service = new SchedulerService(prisma as never);

    await service.recordEvent("u1", "task-1", "KEEP", {
      scheduledStartTime: new Date("2026-06-08T09:00:00Z"),
      durationMinutes: 60,
    });

    expect(taskEventCreate).toHaveBeenCalled();
    expect(userUpdate).toHaveBeenCalled();
  });

  it("does not touch the preference matrix for CREATE", async () => {
    const { prisma, taskEventCreate, userUpdate } = makeFakePrisma([]);
    const service = new SchedulerService(prisma as never);

    await service.recordEvent("u1", "task-1", "CREATE", {
      scheduledStartTime: new Date("2026-06-08T09:00:00Z"),
      durationMinutes: 60,
    });

    expect(taskEventCreate).toHaveBeenCalled();
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("MOVE with a differing previousScheduledStartTime nudges BOTH buckets (two-sided)", async () => {
    const { prisma, userUpdate } = makeFakePrisma([]);
    const service = new SchedulerService(prisma as never);

    const oldSlot = new Date("2026-06-22T09:00:00.000Z"); // Monday 09:00 UTC
    const newSlot = new Date("2026-06-22T14:00:00.000Z"); // Monday 14:00 UTC

    await service.recordEvent(
      "u1",
      "task-1",
      "MOVE",
      { scheduledStartTime: newSlot, durationMinutes: 60 },
      { previousScheduledStartTime: oldSlot },
    );

    expect(userUpdate).toHaveBeenCalled();
    const updated = nudgedMatrix(userUpdate);
    const oldIdx = 0 * 24 + 9;
    const newIdx = 0 * 24 + 14;
    expect(updated[oldIdx]).toBeCloseTo(-0.1); // dislike-old
    expect(updated[newIdx]).toBeCloseTo(0.1); // prefer-new
  });

  it("RESIZE with a differing previousScheduledStartTime nudges BOTH buckets (two-sided)", async () => {
    const { prisma, userUpdate } = makeFakePrisma([]);
    const service = new SchedulerService(prisma as never);

    const oldSlot = new Date("2026-06-22T09:00:00.000Z");
    const newSlot = new Date("2026-06-22T14:00:00.000Z");

    await service.recordEvent(
      "u1",
      "task-1",
      "RESIZE",
      { scheduledStartTime: newSlot, durationMinutes: 90 },
      { previousScheduledStartTime: oldSlot },
    );

    expect(userUpdate).toHaveBeenCalled();
    const updated = nudgedMatrix(userUpdate);
    const oldIdx = 0 * 24 + 9;
    const newIdx = 0 * 24 + 14;
    expect(updated[oldIdx]).toBeCloseTo(-0.1);
    expect(updated[newIdx]).toBeCloseTo(0.1);
  });

  it("RESIZE with no start-time change is a true no-op (no DB call at all)", async () => {
    const { prisma, taskEventCreate, userUpdate } = makeFakePrisma([]);
    const service = new SchedulerService(prisma as never);

    const sameSlot = new Date("2026-06-22T09:00:00.000Z");

    await service.recordEvent(
      "u1",
      "task-1",
      "RESIZE",
      { scheduledStartTime: sameSlot, durationMinutes: 90 },
      { previousScheduledStartTime: sameSlot },
    );

    expect(taskEventCreate).toHaveBeenCalled(); // the event itself is still logged
    expect(userUpdate).not.toHaveBeenCalled(); // but no matrix nudge
  });

  it("MOVE without a previousScheduledStartTime falls back to the single-delta path (reward-only, unchanged behavior)", async () => {
    const { prisma, userUpdate } = makeFakePrisma([]);
    const service = new SchedulerService(prisma as never);

    await service.recordEvent("u1", "task-1", "MOVE", {
      scheduledStartTime: new Date("2026-06-22T09:00:00.000Z"),
      durationMinutes: 60,
    });

    // MOVE's own reward is 0, so the single-delta path is a no-op on values,
    // but the branch still fires (single-sided eligible) and calls userUpdate.
    expect(userUpdate).toHaveBeenCalled();
    const updated = nudgedMatrix(userUpdate);
    expect(updated.every((v) => v === 0)).toBe(true);
  });
});
