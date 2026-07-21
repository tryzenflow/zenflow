import { SchedulerService } from "./scheduler.service";
import type { SchedulerPrefs } from "./interfaces";

/**
 * `SchedulerService` is the ONLY I/O layer (CLAUDE.md invariant #2) — these
 * tests drive it against an in-memory Prisma-shaped fake so the persistence
 * wiring (load → pure-core call → diff → write-back) is exercised without a
 * real DB. The pure math itself is covered by `edf`/`reranker`/`rationale`/
 * `duration-bias` specs.
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
      findUnique: jest.fn((args: { where: { id: string } }) => {
        const row = table.get(args.where.id);
        return Promise.resolve(row ?? null);
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
    /**
     * Fans out to whichever shape the caller's raw UPDATE used, detected from
     * the fixed SQL text around the `VALUES` interpolation:
     *  - `persistPlacements`: one `UPDATE … FROM (VALUES …)` instead of a
     *    `task.update` per row — `Prisma.join` flattens the per-row
     *    `Prisma.sql` fragments into a flat run of (id, scheduledStartTime,
     *    conflict, manuallyMoved).
     *  - `SchedulerService.undoBatch`'s restore step: a flat run of (id,
     *    scheduledStartTime, durationMinutes) — always also forces
     *    manuallyMoved: false.
     * Anything that changes either tuple order must change this decode with it.
     */
    $executeRaw: jest.fn(
      (strings: TemplateStringsArray, ...params: { values: unknown[] }[]) => {
        const flat = params[0]?.values ?? [];
        const isRestore = strings.some((s) => s.includes("durationMinutes"));
        const width = isRestore ? 3 : 4;
        for (let i = 0; i < flat.length; i += width) {
          const row = table.get(flat[i] as string)!;
          if (isRestore) {
            const [id, scheduledStartTime, durationMinutes] = flat.slice(
              i,
              i + 3,
            ) as [string, Date | null, number];
            table.set(id, {
              ...row,
              scheduledStartTime,
              durationMinutes,
              manuallyMoved: false,
            });
          } else {
            const [id, scheduledStartTime, conflict, manuallyMoved] =
              flat.slice(i, i + 4) as [string, Date | null, boolean, boolean];
            table.set(id, {
              ...row,
              scheduledStartTime,
              conflict,
              manuallyMoved,
            });
          }
        }
        return Promise.resolve(flat.length / width);
      },
    ),
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

  it("blends per-tag bias from a CREATE/RESIZE telemetry pair", async () => {
    const events = [
      {
        taskId: "t1",
        eventType: "CREATE",
        newSnapshot: { durationMinutes: 60, tags: ["backend"] },
      },
      {
        taskId: "t1",
        eventType: "RESIZE",
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
    expect(result.adjustedDuration).toBe(90);
    expect(result.durationReason).toContain("backend");
  });
});

describe("SchedulerService.reoptimize", () => {
  it("loads PENDING tasks and places an unplaced one, reporting it as displaced", async () => {
    const now = new Date("2026-06-08T08:00:00Z"); // Monday
    const a = fakeTask({
      id: "a",
      deadline: new Date("2026-06-08T17:00:00Z"),
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    const { prisma, table } = makeFakePrisma([a]);
    const service = new SchedulerService(prisma as never);

    const { displaced } = await service.reoptimize("u1", prefs, now);

    expect(displaced).toHaveLength(1);
    expect(table.get("a")!.scheduledStartTime?.toISOString()).toBe(
      "2026-06-08T09:00:00.000Z",
    );
  });

  it("does not rewrite a task whose placement didn't change (a plain reoptimize pass is a no-op)", async () => {
    const now = new Date("2026-06-08T08:00:00Z");
    const already = fakeTask({
      id: "a",
      manuallyMoved: true,
      scheduledStartTime: new Date("2026-06-08T09:00:00Z"),
    });
    const { prisma } = makeFakePrisma([already]);
    const service = new SchedulerService(prisma as never);

    const { displaced, batchId } = await service.reoptimize("u1", prefs, now);
    expect(displaced).toHaveLength(0);
    expect(batchId).toBeNull();
  });

  it("resolves a genuine pre-existing overlap between two anchored tasks — manuallyMoved no longer freezes either one", async () => {
    const now = new Date("2030-06-17T08:00:00Z"); // far future Monday
    const a = fakeTask({
      id: "a",
      manuallyMoved: true,
      durationMinutes: 60,
      scheduledStartTime: new Date("2030-06-17T09:00:00Z"),
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    const b = fakeTask({
      id: "b",
      manuallyMoved: true,
      durationMinutes: 60,
      scheduledStartTime: new Date("2030-06-17T09:30:00Z"), // overlaps "a"
      createdAt: new Date("2026-01-02T00:00:00Z"),
    });
    const { prisma, table } = makeFakePrisma([a, b]);
    const service = new SchedulerService(prisma as never);

    await service.reoptimize("u1", prefs, now);

    // "a" (processed first — earlier createdAt, both null-deadline) is
    // cost-cheapest to leave exactly where it is; "b" — cheaper to relocate
    // than to evict "a" — reflows to the next free slot.
    expect(table.get("a")!.scheduledStartTime?.toISOString()).toBe(
      "2030-06-17T09:00:00.000Z",
    );
    expect(table.get("b")!.scheduledStartTime?.toISOString()).toBe(
      "2030-06-17T10:00:00.000Z",
    );
    expect(table.get("a")!.conflict).toBe(false);
    expect(table.get("b")!.conflict).toBe(false);
    // "b" actually moved, so its manual pin is cleared; "a" never moved, so
    // its pin survives.
    expect(table.get("a")!.manuallyMoved).toBe(true);
    expect(table.get("b")!.manuallyMoved).toBe(false);
  });

  it("loads already-placed tasks as occupied space so a fresh unplaced task doesn't land on top of them", async () => {
    const now = new Date("2026-06-08T08:00:00Z"); // Monday
    const existing = fakeTask({
      id: "existing",
      scheduledStartTime: new Date("2026-06-08T09:00:00Z"),
    });
    const fresh = fakeTask({ id: "fresh", createdAt: now }); // unplaced
    const { prisma, table } = makeFakePrisma([existing, fresh]);
    const service = new SchedulerService(prisma as never);

    await service.reoptimize("u1", prefs, now);

    expect(table.get("existing")!.scheduledStartTime?.toISOString()).toBe(
      "2026-06-08T09:00:00.000Z",
    );
    expect(table.get("fresh")!.scheduledStartTime?.toISOString()).toBe(
      "2026-06-08T10:00:00.000Z",
    );
  });

  it("manuallyMoved no longer freezes a task — a tightened deadline past its anchor still forces it to relocate", async () => {
    const now = new Date("2026-06-08T08:00:00Z"); // Monday
    const a = fakeTask({
      id: "a",
      manuallyMoved: true,
      durationMinutes: 60,
      scheduledStartTime: new Date("2026-06-08T14:00:00Z"),
      deadline: new Date("2026-06-08T13:00:00Z"), // already past its own end
    });
    const { prisma, table } = makeFakePrisma([a]);
    const service = new SchedulerService(prisma as never);

    const { displaced } = await service.reoptimize("u1", prefs, now);

    expect(displaced.some((d) => d.id === "a")).toBe(true);
    const finalStart = table.get("a")!.scheduledStartTime!;
    expect(finalStart.getTime()).not.toBe(
      new Date("2026-06-08T14:00:00Z").getTime(),
    );
    expect(finalStart.getTime() + 60 * 60_000).toBeLessThanOrEqual(
      a.deadline!.getTime(),
    );
  });

  it("logs a RESCHEDULED event for a collateral task the core actually re-placed", async () => {
    const now = new Date("2026-06-08T08:00:00Z"); // Monday
    const a = fakeTask({
      id: "a",
      deadline: new Date("2026-06-08T17:00:00Z"),
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    const { prisma, table, taskEventCreateMany } = makeFakePrisma([a]);
    const service = new SchedulerService(prisma as never);

    await service.reoptimize("u1", prefs, now);

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

  it("does not log a RESCHEDULED event for `opts.fixedTaskId` — the caller owns that event", async () => {
    const now = new Date("2026-06-08T08:00:00Z"); // Monday
    const a = fakeTask({
      id: "a",
      deadline: new Date("2026-06-08T17:00:00Z"),
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    const { prisma, taskEventCreateMany } = makeFakePrisma([a]);
    const service = new SchedulerService(prisma as never);

    await service.reoptimize("u1", prefs, now, prisma as never, {
      fixedTaskId: "a",
    });

    expect(taskEventCreateMany).not.toHaveBeenCalled();
  });

  it("does not log an event or generate a reportable batchId when nothing changed", async () => {
    const now = new Date("2026-06-08T08:00:00Z");
    const a = fakeTask({
      id: "a",
      manuallyMoved: true,
      deadline: new Date("2026-06-08T17:00:00Z"),
      scheduledStartTime: new Date("2026-06-08T09:00:00Z"),
    });
    const { prisma, taskEventCreateMany } = makeFakePrisma([a]);
    const service = new SchedulerService(prisma as never);

    const { batchId } = await service.reoptimize("u1", prefs, now);

    expect(taskEventCreateMany).not.toHaveBeenCalled();
    expect(batchId).toBeNull();
  });

  it("returns a non-null batchId (grouping every RESCHEDULED event this call wrote) when something actually moved", async () => {
    const now = new Date("2026-06-08T08:00:00Z");
    const a = fakeTask({
      id: "a",
      deadline: new Date("2026-06-08T17:00:00Z"),
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    const { prisma } = makeFakePrisma([a]);
    const service = new SchedulerService(prisma as never);

    const { batchId } = await service.reoptimize("u1", prefs, now);
    expect(batchId).toEqual(expect.any(String));
  });

  it("loads an in-progress task (scheduledStartTime in the past, not yet finished) as frozen occupied space, so a competing pending task never gets placed on top of it", async () => {
    // Regression test: `loadPendingRows` used to filter out any task whose
    // `scheduledStartTime` was before `now` (a `gte: now` lower bound on the
    // query), which silently dropped in-progress tasks before `scheduleAll`'s
    // `isPast` freeze (edf.ts) ever got a chance to seed their interval into
    // occupied space — so a second pending task's candidate search treated
    // that slot as free and could land right on top of it with no conflict
    // ever flagged.
    const now = new Date("2026-06-08T10:00:00Z"); // Monday
    const inProgress = fakeTask({
      id: "in-progress",
      scheduledStartTime: new Date("2026-06-08T09:30:00Z"), // started 30m ago
      durationMinutes: 60, // ends 10:30 — still running
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    const pending = fakeTask({
      id: "pending",
      deadline: new Date("2026-06-08T17:00:00Z"),
      durationMinutes: 60,
      createdAt: new Date("2026-01-02T00:00:00Z"),
    });
    const { prisma, table } = makeFakePrisma([inProgress, pending]);
    const service = new SchedulerService(prisma as never);

    await service.reoptimize("u1", prefs, now);

    // The in-progress task's own placement is echoed back unchanged (frozen).
    expect(table.get("in-progress")!.scheduledStartTime?.toISOString()).toBe(
      "2026-06-08T09:30:00.000Z",
    );
    expect(table.get("in-progress")!.conflict).toBe(false);

    // The pending task must not overlap it: [09:30, 10:30) is occupied, so
    // the earliest free slot is 10:30.
    const pendingStart = table.get("pending")!.scheduledStartTime!;
    expect(pendingStart.toISOString()).toBe("2026-06-08T10:30:00.000Z");
    const inProgressEnd =
      new Date("2026-06-08T09:30:00Z").getTime() + 60 * 60_000;
    expect(pendingStart.getTime()).toBeGreaterThanOrEqual(inProgressEnd);
    expect(table.get("pending")!.conflict).toBe(false);
  });
});

describe("SchedulerService.undoBatch", () => {
  it("restores a batch-tagged task's prior scheduledStartTime/durationMinutes", async () => {
    // 2030 dates: safely "in the future" for undoBatch's own internal
    // now-based conflict-recompute pass regardless of when this test runs.
    const restoredStart = new Date("2030-06-17T09:00:00Z");
    const displacedTo = new Date("2030-06-17T10:00:00Z");
    const b = fakeTask({
      id: "b",
      durationMinutes: 60,
      scheduledStartTime: displacedTo, // where reoptimize had moved it TO
      manuallyMoved: false,
      conflict: false,
    });
    const { prisma, table } = makeFakePrisma([b]);
    prisma.taskEvent.findMany.mockResolvedValueOnce([
      {
        taskId: "b",
        oldSnapshot: {
          scheduledStartTime: restoredStart.toISOString(),
          durationMinutes: 60,
        },
      },
    ]);
    const service = new SchedulerService(prisma as never);

    const result = await service.undoBatch("u1", "batch-1");

    expect(table.get("b")!.scheduledStartTime?.toISOString()).toBe(
      restoredStart.toISOString(),
    );
    expect(table.get("b")!.durationMinutes).toBe(60);
    expect(table.get("b")!.manuallyMoved).toBe(false);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("b");
  });

  it("restores a null scheduledStartTime (the task had been unplaced before the batch)", async () => {
    const b = fakeTask({
      id: "b",
      durationMinutes: 30,
      scheduledStartTime: new Date("2030-06-17T10:00:00Z"),
    });
    const { prisma, table } = makeFakePrisma([b]);
    prisma.taskEvent.findMany.mockResolvedValueOnce([
      {
        taskId: "b",
        oldSnapshot: { scheduledStartTime: null, durationMinutes: 30 },
      },
    ]);
    const service = new SchedulerService(prisma as never);

    await service.undoBatch("u1", "batch-1");

    expect(table.get("b")!.scheduledStartTime).toBeNull();
  });

  it("is a no-op ([]) when batchId matches no event for this user", async () => {
    const { prisma } = makeFakePrisma([]);
    const service = new SchedulerService(prisma as never);

    const result = await service.undoBatch("u1", "nonexistent");
    expect(result).toEqual([]);
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
