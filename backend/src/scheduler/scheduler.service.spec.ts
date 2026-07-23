import { SchedulerService } from "./scheduler.service";
import type { SchedulerPrefs } from "./interfaces";

/**
 * `SchedulerService` is the ONLY I/O layer (CLAUDE.md invariant #2) — these
 * tests drive it against an in-memory Prisma-shaped fake so the persistence
 * wiring (load → pure-core call → diff → write-back) is exercised without a
 * real DB. The pure math itself is covered by `place`/`optimize`/`reranker`/
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
  title: string;
  durationMinutes: number;
  deadline: Date | null;
  manuallyMoved: boolean;
  scheduledStartTime: Date | null;
  createdAt: Date;
  conflict: boolean;
  status: string;
}

interface FakeEvent {
  taskId: string;
  userId: string;
  eventType: string;
  oldSnapshot: unknown;
  newSnapshot: unknown;
  rewardScore: number;
  occurredAt: Date;
  batchId: string | null;
}

function fakeTask(overrides: Partial<FakeTask> & { id: string }): FakeTask {
  return {
    userId: "u1",
    title: "Task",
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

function matchesStatus(t: FakeTask, filter: unknown): boolean {
  if (filter === undefined) return true;
  if (typeof filter === "string") return t.status === filter;
  const notFilter = filter as { not?: string };
  if (notFilter && typeof notFilter === "object" && "not" in notFilter)
    return t.status !== notFilter.not;
  return true;
}

function matchesId(t: FakeTask, clause: unknown): boolean {
  if (clause === undefined) return true;
  if (typeof clause === "string") return t.id === clause;
  const c = clause as { not?: string; in?: string[] };
  if (c.not !== undefined && t.id === c.not) return false;
  if (c.in !== undefined && !c.in.includes(t.id)) return false;
  return true;
}

function matchesScheduledStartTime(t: FakeTask, clause: unknown): boolean {
  if (clause === undefined) return true;
  if (clause === null) return t.scheduledStartTime === null;
  const c = clause as {
    not?: null;
    lt?: Date;
    lte?: Date;
    gt?: Date;
    gte?: Date;
  };
  if (c.not === null && t.scheduledStartTime === null) return false;
  if (t.scheduledStartTime === null) {
    return (
      c.lt === undefined &&
      c.lte === undefined &&
      c.gt === undefined &&
      c.gte === undefined
    );
  }
  const time = t.scheduledStartTime.getTime();
  if (c.lt !== undefined && !(time < c.lt.getTime())) return false;
  if (c.lte !== undefined && !(time <= c.lte.getTime())) return false;
  if (c.gt !== undefined && !(time > c.gt.getTime())) return false;
  if (c.gte !== undefined && !(time >= c.gte.getTime())) return false;
  return true;
}

function matchesWhere(
  t: FakeTask,
  where: Record<string, unknown> | undefined,
): boolean {
  if (!where) return true;
  if (where.userId !== undefined && t.userId !== where.userId) return false;
  if (!matchesStatus(t, where.status)) return false;
  if (!matchesId(t, where.id)) return false;
  if (!matchesScheduledStartTime(t, where.scheduledStartTime)) return false;
  if (where.OR !== undefined) {
    const clauses = where.OR as Record<string, unknown>[];
    if (!clauses.some((c) => matchesWhere(t, c))) return false;
  }
  return true;
}

function matchesTaskEventWhere(
  e: FakeEvent,
  where: Record<string, unknown> | undefined,
): boolean {
  if (!where) return true;
  if (where.userId !== undefined && e.userId !== where.userId) return false;
  if (where.batchId !== undefined && e.batchId !== where.batchId) return false;
  if (where.taskId !== undefined) {
    if (typeof where.taskId === "string") {
      if (e.taskId !== where.taskId) return false;
    } else {
      const c = where.taskId as { in?: string[] };
      if (c.in && !c.in.includes(e.taskId)) return false;
    }
  }
  if (where.NOT !== undefined) {
    const not = where.NOT as { batchId?: string };
    if (not.batchId !== undefined && e.batchId === not.batchId) return false;
  }
  return true;
}

/**
 * Builds a fake Prisma-shaped object. `userRow`'s `preferenceMatrix` has TWO
 * views: a "committed" one (what `this.prisma` — outside any transaction —
 * sees) and a transaction-local one (what the `db` handle `$transaction`
 * hands to its callback sees), diverging once a transaction starts. This is
 * the fake-Prisma upgrade needed to actually observe `recordEvent`'s
 * preference-matrix read/write race: the old code read via `this.prisma`
 * (always the committed view) while writing via `db` (transaction-local) —
 * invisible to a fake where both were literally the same object. A SECOND
 * `recordEvent` call inside the SAME transaction now genuinely sees the
 * FIRST call's own in-transaction write only if the read goes through `db`
 * too.
 */
function makeFakePrisma(
  tasks: FakeTask[],
  userRow?: { preferenceMatrix: number[]; timezone: string },
) {
  const table = new Map(tasks.map((t) => [t.id, t]));
  const events: FakeEvent[] = [];
  const seedUser = userRow ?? { preferenceMatrix: [], timezone: "UTC" };
  let committedUser = { ...seedUser };

  const taskEventCreate = jest.fn((args: { data: Record<string, unknown> }) => {
    events.push({
      taskId: args.data.taskId as string,
      userId: args.data.userId as string,
      eventType: args.data.eventType as string,
      oldSnapshot: args.data.oldSnapshot,
      newSnapshot: args.data.newSnapshot,
      rewardScore: args.data.rewardScore as number,
      occurredAt: (args.data.occurredAt as Date) ?? new Date(),
      batchId: (args.data.batchId as string | undefined) ?? null,
    });
    return Promise.resolve({});
  });
  const taskEventCreateMany = jest.fn(
    (args: { data: Record<string, unknown>[] }) => {
      for (const d of args.data) {
        events.push({
          taskId: d.taskId as string,
          userId: d.userId as string,
          eventType: d.eventType as string,
          oldSnapshot: d.oldSnapshot,
          newSnapshot: d.newSnapshot,
          rewardScore: d.rewardScore as number,
          occurredAt: (d.occurredAt as Date) ?? new Date(),
          batchId: (d.batchId as string | undefined) ?? null,
        });
      }
      return Promise.resolve({ count: args.data.length });
    },
  );
  // Loosely typed (`Partial<FakeEvent>[]`) so individual tests can
  // `mockResolvedValueOnce` a minimal ad-hoc shape (only the fields that
  // particular call site actually reads) without satisfying every FakeEvent
  // field.
  const taskEventFindMany: jest.Mock<
    Promise<Partial<FakeEvent>[]>,
    [{ where?: Record<string, unknown> }?]
  > = jest.fn((args = {}) =>
    Promise.resolve(events.filter((e) => matchesTaskEventWhere(e, args.where))),
  );

  const taskFindMany = jest.fn(
    (args: { where?: Record<string, unknown> } = {}) =>
      Promise.resolve(
        [...table.values()].filter((t) => matchesWhere(t, args.where)),
      ),
  );
  const taskUpdate = jest.fn(
    (args: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = table.get(args.where.id)!;
      const next = { ...row, ...args.data };
      table.set(args.where.id, next);
      return Promise.resolve(next);
    },
  );
  const taskFindUniqueOrThrow = jest.fn((args: { where: { id: string } }) => {
    const row = table.get(args.where.id);
    if (!row) return Promise.reject(new Error("not found"));
    return Promise.resolve(row);
  });
  const taskFindUnique = jest.fn((args: { where: { id: string } }) => {
    const row = table.get(args.where.id);
    return Promise.resolve(row ?? null);
  });

  /**
   * Fans out to whichever raw-UPDATE shape the caller used (detected from
   * the fixed SQL text around the `VALUES` interpolation):
   *  - `persistPlacements`: (id, scheduledStartTime, conflict, manuallyMoved).
   *  - `undoBatch`'s restore step: (id, scheduledStartTime, durationMinutes)
   *    — always also forces manuallyMoved: false.
   */
  const executeRaw = jest.fn(
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
          const [id, scheduledStartTime, conflict, manuallyMoved] = flat.slice(
            i,
            i + 4,
          ) as [string, Date | null, boolean, boolean];
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
  );

  const dbBase = {
    task: {
      findMany: taskFindMany,
      update: taskUpdate,
      findUniqueOrThrow: taskFindUniqueOrThrow,
      findUnique: taskFindUnique,
    },
    taskEvent: {
      create: taskEventCreate,
      createMany: taskEventCreateMany,
      findMany: taskEventFindMany,
    },
    $executeRaw: executeRaw,
  };

  const userUpdateCommitted = jest.fn(
    (args: { data: Record<string, unknown> }) => {
      committedUser = {
        ...committedUser,
        ...args.data,
      };
      return Promise.resolve(committedUser);
    },
  );
  const userFindUniqueOrThrowCommitted = jest.fn(() =>
    Promise.resolve(committedUser),
  );

  const prisma = {
    ...dbBase,
    user: {
      findUniqueOrThrow: userFindUniqueOrThrowCommitted,
      update: userUpdateCommitted,
    },
    $transaction: (fn: (t: unknown) => unknown) => {
      // A transaction sees a SNAPSHOT of the committed state at its start,
      // then diverges independently — mirroring how a real DB transaction
      // reads a consistent view and only the CALLER'S OWN reads/writes
      // (through its `db` handle) see its own in-progress changes.
      let txUser = { ...committedUser };
      const txUserUpdate = jest.fn(
        (args: { data: Record<string, unknown> }) => {
          txUser = { ...txUser, ...args.data };
          return Promise.resolve(txUser);
        },
      );
      const txUserFindUniqueOrThrow = jest.fn(() => Promise.resolve(txUser));
      const tx = {
        ...dbBase,
        user: {
          findUniqueOrThrow: txUserFindUniqueOrThrow,
          update: txUserUpdate,
        },
      };
      return Promise.resolve(fn(tx));
    },
  };

  return {
    prisma,
    table,
    events,
    taskEventCreate,
    taskEventCreateMany,
    userUpdate: userUpdateCommitted,
    getCommittedUser: () => committedUser,
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

describe("SchedulerService.placeNewTask", () => {
  it("places a brand-new task at the earliest feasible slot on an empty calendar", async () => {
    const now = new Date("2026-06-08T08:00:00Z"); // Monday
    const { prisma, table } = makeFakePrisma([]);
    const service = new SchedulerService(prisma as never);

    const task = {
      id: "a",
      durationMinutes: 60,
      deadline: new Date("2026-06-08T17:00:00Z"),
      manuallyMoved: false,
      scheduledStartTime: null,
      createdAt: now,
      conflict: false,
    };
    const result = await service.placeNewTask("u1", prefs, now, task);

    expect(result.interval).toEqual({
      start: new Date("2026-06-08T09:00:00Z").getTime(),
      end: new Date("2026-06-08T10:00:00Z").getTime(),
    });
    expect(result.rationale.summary).toEqual(expect.any(String));
    // Nothing else in the (empty) table was touched.
    expect(table.size).toBe(0);
  });

  it("routes around another pending task's occupied slot, never touching that task", async () => {
    const now = new Date("2026-06-08T08:00:00Z");
    const existing = fakeTask({
      id: "existing",
      scheduledStartTime: new Date("2026-06-08T09:00:00Z"),
    });
    const { prisma, table } = makeFakePrisma([existing]);
    const service = new SchedulerService(prisma as never);

    const task = {
      id: "fresh",
      durationMinutes: 60,
      deadline: new Date("2026-06-08T17:00:00Z"),
      manuallyMoved: false,
      scheduledStartTime: null,
      createdAt: now,
      conflict: false,
    };
    const result = await service.placeNewTask("u1", prefs, now, task);

    expect(new Date(result.interval!.start).toISOString()).toBe(
      "2026-06-08T10:00:00.000Z",
    );
    // "existing" is completely untouched.
    expect(table.get("existing")!.scheduledStartTime?.toISOString()).toBe(
      "2026-06-08T09:00:00.000Z",
    );
  });

  it("comes back unplaced (no throw) on a genuinely saturated calendar", async () => {
    const now = new Date("2026-06-08T08:00:00Z");
    // A full-day "wall" task every day across the whole MAX_SCAN_DAYS horizon
    // — genuinely nothing free anywhere Tier1/2/3 could reach.
    const walls = Array.from({ length: 92 }, (_, i) => {
      const day = new Date(now.getTime() + i * 24 * 60 * 60 * 1000);
      const dateStr = day.toISOString().slice(0, 10);
      return fakeTask({
        id: `wall-${i}`,
        scheduledStartTime: new Date(`${dateStr}T00:00:00.000Z`),
        durationMinutes: 24 * 60,
      });
    });
    const { prisma } = makeFakePrisma(walls);
    const service = new SchedulerService(prisma as never);
    const task = {
      id: "a",
      durationMinutes: 60,
      deadline: new Date("2026-06-08T17:00:00Z"),
      manuallyMoved: false,
      scheduledStartTime: null,
      createdAt: now,
      conflict: false,
    };
    const result = await service.placeNewTask("u1", prefs, now, task);
    expect(result.interval).toBeNull();
    expect(result.tier).toBe("unplaced");
    expect(result.rationale.summary).toContain("fully booked");
  });
});

describe("SchedulerService.resolveInvalidPlacement", () => {
  it("excludes the task's OWN stale slot from occupied space so it doesn't block its own re-placement", async () => {
    const now = new Date("2026-06-08T08:00:00Z");
    const stale = fakeTask({
      id: "a",
      conflict: true,
      scheduledStartTime: new Date("2026-06-08T09:00:00Z"),
      deadline: new Date("2026-06-08T09:30:00Z"), // tightened past the stale slot's own end
      durationMinutes: 60,
    });
    const { prisma } = makeFakePrisma([stale]);
    const service = new SchedulerService(prisma as never);

    const result = await service.resolveInvalidPlacement(
      "u1",
      prefs,
      now,
      stale,
    );

    expect(result.interval).not.toBeNull();
    expect(result.interval!.end).toBeLessThanOrEqual(stale.deadline!.getTime());
  });
});

describe("SchedulerService.applyDirectPlacement", () => {
  it("writes the requested interval unconditionally and reports no conflict on an empty calendar", async () => {
    const a = fakeTask({ id: "a", durationMinutes: 60 });
    const { prisma, table } = makeFakePrisma([a]);
    const service = new SchedulerService(prisma as never);

    const requested = {
      start: new Date("2026-06-08T14:00:00Z").getTime(),
      end: new Date("2026-06-08T15:00:00Z").getTime(),
    };
    const result = await service.applyDirectPlacement("u1", a, requested);

    expect(result.conflict).toBe(false);
    expect(table.get("a")!.scheduledStartTime?.toISOString()).toBe(
      "2026-06-08T14:00:00.000Z",
    );
    expect(table.get("a")!.manuallyMoved).toBe(true);
  });

  it("flags BOTH tasks conflicting when the requested interval overlaps another task — neither is auto-relocated", async () => {
    const a = fakeTask({ id: "a", durationMinutes: 60 });
    const b = fakeTask({
      id: "b",
      title: "Draft proposal",
      durationMinutes: 60,
      scheduledStartTime: new Date("2026-06-08T09:00:00Z"),
    });
    const { prisma, table } = makeFakePrisma([a, b]);
    const service = new SchedulerService(prisma as never);

    const requested = {
      start: new Date("2026-06-08T09:30:00Z").getTime(),
      end: new Date("2026-06-08T10:30:00Z").getTime(),
    };
    const result = await service.applyDirectPlacement("u1", a, requested);

    expect(result.conflict).toBe(true);
    expect(result.conflictWithTitle).toBe("Draft proposal");
    expect(table.get("a")!.conflict).toBe(true);
    expect(table.get("b")!.conflict).toBe(true);
    // "b" never moved.
    expect(table.get("b")!.scheduledStartTime?.toISOString()).toBe(
      "2026-06-08T09:00:00.000Z",
    );
  });

  it("clears a neighbor's conflict when moving away resolves it", async () => {
    const a = fakeTask({
      id: "a",
      durationMinutes: 60,
      scheduledStartTime: new Date("2026-06-08T09:00:00Z"),
      conflict: true,
    });
    const b = fakeTask({
      id: "b",
      durationMinutes: 60,
      scheduledStartTime: new Date("2026-06-08T09:00:00Z"),
      conflict: true,
    });
    const { prisma, table } = makeFakePrisma([a, b]);
    const service = new SchedulerService(prisma as never);

    const requested = {
      start: new Date("2026-06-08T14:00:00Z").getTime(),
      end: new Date("2026-06-08T15:00:00Z").getTime(),
    };
    await service.applyDirectPlacement("u1", a, requested);

    expect(table.get("a")!.conflict).toBe(false);
    expect(table.get("b")!.conflict).toBe(false);
  });
});

describe("SchedulerService.freeSlot", () => {
  it("clears a neighbor's conflict flag that was ONLY conflicting with the freed task", async () => {
    const removed = fakeTask({
      id: "removed",
      durationMinutes: 60,
      scheduledStartTime: new Date("2026-06-08T09:00:00Z"),
      conflict: true,
    });
    const neighbor = fakeTask({
      id: "neighbor",
      durationMinutes: 60,
      scheduledStartTime: new Date("2026-06-08T09:00:00Z"),
      conflict: true,
    });
    const { prisma, table } = makeFakePrisma([removed, neighbor]);
    const service = new SchedulerService(prisma as never);

    await service.freeSlot("u1", removed);

    expect(table.get("neighbor")!.conflict).toBe(false);
  });

  it("leaves an unrelated conflict untouched", async () => {
    const removed = fakeTask({
      id: "removed",
      durationMinutes: 60,
      scheduledStartTime: new Date("2026-06-08T09:00:00Z"),
    });
    const c = fakeTask({
      id: "c",
      durationMinutes: 60,
      scheduledStartTime: new Date("2026-06-08T13:00:00Z"),
      conflict: true,
    });
    const d = fakeTask({
      id: "d",
      durationMinutes: 60,
      scheduledStartTime: new Date("2026-06-08T13:00:00Z"),
      conflict: true,
    });
    const { prisma, table } = makeFakePrisma([removed, c, d]);
    const service = new SchedulerService(prisma as never);

    await service.freeSlot("u1", removed);

    expect(table.get("c")!.conflict).toBe(true);
    expect(table.get("d")!.conflict).toBe(true);
  });

  it("is a no-op for a task that was never placed", async () => {
    const unplaced = fakeTask({ id: "a", scheduledStartTime: null });
    const { prisma, table } = makeFakePrisma([unplaced]);
    const service = new SchedulerService(prisma as never);
    await expect(service.freeSlot("u1", unplaced)).resolves.toBeUndefined();
    expect(table.get("a")).toEqual(unplaced);
  });
});

describe("SchedulerService.optimizeWindow", () => {
  const windowStart = new Date("2026-06-08T00:00:00Z");
  const windowEnd = new Date("2026-06-08T23:59:59Z");
  const now = new Date("2026-06-08T08:00:00Z");

  it("dry run: counts without writing anything", async () => {
    const a = fakeTask({
      id: "a",
      durationMinutes: 60,
      scheduledStartTime: new Date("2026-06-08T09:30:00Z"),
    });
    const b = fakeTask({
      id: "b",
      durationMinutes: 60,
      scheduledStartTime: new Date("2026-06-08T09:00:00Z"),
      createdAt: new Date("2026-01-02T00:00:00Z"),
    });
    const { prisma, table } = makeFakePrisma([a, b]);
    const service = new SchedulerService(prisma as never);

    const result = await service.optimizeWindow(
      "u1",
      prefs,
      now,
      windowStart,
      windowEnd,
      "full",
      prisma as never,
      { dryRun: true },
    );

    expect(result.batchId).toBeNull();
    // Nothing written.
    expect(table.get("a")!.scheduledStartTime?.toISOString()).toBe(
      "2026-06-08T09:30:00.000Z",
    );
    expect(table.get("b")!.scheduledStartTime?.toISOString()).toBe(
      "2026-06-08T09:00:00.000Z",
    );
  });

  it("apply mode 'full': reflows the window and returns a batchId", async () => {
    const a = fakeTask({
      id: "a",
      durationMinutes: 60,
      scheduledStartTime: new Date("2026-06-08T09:30:00Z"),
    });
    const b = fakeTask({
      id: "b",
      durationMinutes: 60,
      scheduledStartTime: new Date("2026-06-08T09:00:00Z"),
      createdAt: new Date("2026-01-02T00:00:00Z"),
    });
    const { prisma, table } = makeFakePrisma([a, b]);
    const service = new SchedulerService(prisma as never);

    const result = await service.optimizeWindow(
      "u1",
      prefs,
      now,
      windowStart,
      windowEnd,
      "full",
      prisma as never,
      { dryRun: false },
    );

    expect(result.count).toBeGreaterThan(0);
    expect(result.batchId).toEqual(expect.any(String));
    expect(table.get("a")!.conflict).toBe(false);
    expect(table.get("b")!.conflict).toBe(false);
  });

  it("mode 'retainManual': never repositions a manually-moved task, even if it's the one causing the overlap", async () => {
    const manual = fakeTask({
      id: "manual",
      manuallyMoved: true,
      durationMinutes: 60,
      scheduledStartTime: new Date("2026-06-08T09:00:00Z"),
    });
    const flexible = fakeTask({
      id: "flexible",
      durationMinutes: 60,
      scheduledStartTime: new Date("2026-06-08T09:30:00Z"), // overlaps "manual"
      createdAt: new Date("2026-01-02T00:00:00Z"),
    });
    const { prisma, table } = makeFakePrisma([manual, flexible]);
    const service = new SchedulerService(prisma as never);

    const result = await service.optimizeWindow(
      "u1",
      prefs,
      now,
      windowStart,
      windowEnd,
      "retainManual",
      prisma as never,
      { dryRun: false },
    );

    // "manual" never moves.
    expect(table.get("manual")!.scheduledStartTime?.toISOString()).toBe(
      "2026-06-08T09:00:00.000Z",
    );
    expect(result.fixedCount).toBe(1);
    // "flexible" reflows around it.
    expect(table.get("flexible")!.scheduledStartTime?.toISOString()).not.toBe(
      "2026-06-08T09:30:00.000Z",
    );
    expect(table.get("flexible")!.conflict).toBe(false);
  });

  it("seeds occupied space from outside the window so a repacked task never lands on an out-of-window task", async () => {
    const outside = fakeTask({
      id: "outside",
      durationMinutes: 60,
      scheduledStartTime: new Date("2026-06-09T09:00:00Z"), // Tuesday — outside the window
    });
    const inWindow = fakeTask({
      id: "in-window",
      durationMinutes: 60,
      deadline: new Date("2026-06-09T09:00:00Z"), // no in-window in-hours room forces a look past today, this deadline still allows Monday
      scheduledStartTime: new Date("2026-06-08T09:00:00Z"),
      createdAt: new Date("2026-01-02T00:00:00Z"),
    });
    const { prisma, table } = makeFakePrisma([outside, inWindow]);
    const service = new SchedulerService(prisma as never);

    await service.optimizeWindow(
      "u1",
      prefs,
      now,
      windowStart,
      windowEnd,
      "balanced",
      prisma as never,
      { dryRun: false },
    );

    // The outside task is completely untouched.
    expect(table.get("outside")!.scheduledStartTime?.toISOString()).toBe(
      "2026-06-09T09:00:00.000Z",
    );
  });
});

describe("SchedulerService.undoBatch", () => {
  it("restores a batch-tagged task's prior scheduledStartTime/durationMinutes", async () => {
    const restoredStart = new Date("2030-06-17T09:00:00Z");
    const displacedTo = new Date("2030-06-17T10:00:00Z");
    const b = fakeTask({
      id: "b",
      durationMinutes: 60,
      scheduledStartTime: displacedTo,
      manuallyMoved: false,
      conflict: false,
    });
    const { prisma, table } = makeFakePrisma([b]);
    prisma.taskEvent.findMany.mockResolvedValueOnce([
      {
        taskId: "b",
        occurredAt: new Date("2030-06-17T08:00:00Z"),
        oldSnapshot: {
          scheduledStartTime: restoredStart.toISOString(),
          durationMinutes: 60,
        },
      },
    ]);
    const service = new SchedulerService(prisma as never);

    const result = await service.undoBatch("u1", "batch-1");

    expect(result.found).toBe(true);
    expect(table.get("b")!.scheduledStartTime?.toISOString()).toBe(
      restoredStart.toISOString(),
    );
    expect(table.get("b")!.durationMinutes).toBe(60);
    expect(table.get("b")!.manuallyMoved).toBe(false);
    expect(result.displaced).toHaveLength(1);
    expect(result.displaced[0].id).toBe("b");
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
        occurredAt: new Date("2030-06-17T08:00:00Z"),
        oldSnapshot: { scheduledStartTime: null, durationMinutes: 30 },
      },
    ]);
    const service = new SchedulerService(prisma as never);

    await service.undoBatch("u1", "batch-1");

    expect(table.get("b")!.scheduledStartTime).toBeNull();
  });

  it("found: false when batchId matches no event for this user", async () => {
    const { prisma } = makeFakePrisma([]);
    const service = new SchedulerService(prisma as never);

    const result = await service.undoBatch("u1", "nonexistent");
    expect(result.found).toBe(false);
    expect(result.displaced).toEqual([]);
  });

  describe("touched-since pre-flight check", () => {
    it("requires confirmation (writes nothing) when a batched task was touched again since", async () => {
      const b = fakeTask({
        id: "b",
        durationMinutes: 60,
        scheduledStartTime: new Date("2030-06-17T10:00:00Z"),
      });
      const { prisma, table } = makeFakePrisma([b]);
      const batchTime = new Date("2030-06-17T08:00:00Z");
      prisma.taskEvent.findMany
        .mockResolvedValueOnce([
          {
            taskId: "b",
            occurredAt: batchTime,
            oldSnapshot: {
              scheduledStartTime: new Date(
                "2030-06-17T09:00:00Z",
              ).toISOString(),
              durationMinutes: 60,
            },
          },
        ])
        .mockResolvedValueOnce([
          // A later MOVE event for "b", NOT tagged with this batch — the
          // user dragged it again after the auto-move.
          {
            taskId: "b",
            occurredAt: new Date("2030-06-17T09:30:00Z"),
            batchId: null,
          },
        ]);
      const service = new SchedulerService(prisma as never);

      const result = await service.undoBatch("u1", "batch-1");

      expect(result.found).toBe(true);
      expect(result.requiresConfirmation).toBe(true);
      expect(result.touchedTaskIds).toEqual(["b"]);
      expect(result.displaced).toEqual([]);
      // Nothing written.
      expect(table.get("b")!.scheduledStartTime?.toISOString()).toBe(
        "2030-06-17T10:00:00.000Z",
      );
    });

    it('strategy "all" reverts every row regardless of being touched', async () => {
      const b = fakeTask({
        id: "b",
        durationMinutes: 60,
        scheduledStartTime: new Date("2030-06-17T10:00:00Z"),
      });
      const { prisma, table } = makeFakePrisma([b]);
      const batchTime = new Date("2030-06-17T08:00:00Z");
      prisma.taskEvent.findMany
        .mockResolvedValueOnce([
          {
            taskId: "b",
            occurredAt: batchTime,
            oldSnapshot: {
              scheduledStartTime: new Date(
                "2030-06-17T09:00:00Z",
              ).toISOString(),
              durationMinutes: 60,
            },
          },
        ])
        .mockResolvedValueOnce([
          {
            taskId: "b",
            occurredAt: new Date("2030-06-17T09:30:00Z"),
            batchId: null,
          },
        ]);
      const service = new SchedulerService(prisma as never);

      const result = await service.undoBatch(
        "u1",
        "batch-1",
        prisma as never,
        "all",
      );

      expect(result.requiresConfirmation).toBeUndefined();
      expect(table.get("b")!.scheduledStartTime?.toISOString()).toBe(
        "2030-06-17T09:00:00.000Z",
      );
    });

    it('strategy "excludeTouched" skips the touched row, reverting only the untouched ones', async () => {
      const b = fakeTask({
        id: "b",
        durationMinutes: 60,
        scheduledStartTime: new Date("2030-06-17T10:00:00Z"),
      });
      const c = fakeTask({
        id: "c",
        durationMinutes: 30,
        scheduledStartTime: new Date("2030-06-17T11:00:00Z"),
      });
      const { prisma, table } = makeFakePrisma([b, c]);
      const batchTime = new Date("2030-06-17T08:00:00Z");
      prisma.taskEvent.findMany
        .mockResolvedValueOnce([
          {
            taskId: "b",
            occurredAt: batchTime,
            oldSnapshot: {
              scheduledStartTime: new Date(
                "2030-06-17T09:00:00Z",
              ).toISOString(),
              durationMinutes: 60,
            },
          },
          {
            taskId: "c",
            occurredAt: batchTime,
            oldSnapshot: {
              scheduledStartTime: new Date(
                "2030-06-17T09:30:00Z",
              ).toISOString(),
              durationMinutes: 30,
            },
          },
        ])
        .mockResolvedValueOnce([
          // Only "b" was touched again since.
          {
            taskId: "b",
            occurredAt: new Date("2030-06-17T09:45:00Z"),
            batchId: null,
          },
        ]);
      const service = new SchedulerService(prisma as never);

      const result = await service.undoBatch(
        "u1",
        "batch-1",
        prisma as never,
        "excludeTouched",
      );

      // "b" (touched) stays exactly where it currently is.
      expect(table.get("b")!.scheduledStartTime?.toISOString()).toBe(
        "2030-06-17T10:00:00.000Z",
      );
      // "c" (untouched) reverts.
      expect(table.get("c")!.scheduledStartTime?.toISOString()).toBe(
        "2030-06-17T09:30:00.000Z",
      );
      expect(result.displaced.map((d) => d.id)).toEqual(["c"]);
    });
  });
});

/** Pull the `preferenceMatrix` a fake `user.update` mock was called with. */
function nudgedMatrix(userUpdate: jest.Mock): number[] {
  const calls = userUpdate.mock.calls as {
    data: { preferenceMatrix: number[] };
  }[][];
  return calls[calls.length - 1][0].data.preferenceMatrix;
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

  describe("the preference-matrix read/write race fix", () => {
    it("reads the preference matrix through the SAME `db` handle its write uses, so two calls within one transaction accumulate instead of losing an update", async () => {
      const zeroMatrix = new Array<number>(168).fill(0);
      const { prisma } = makeFakePrisma([], {
        preferenceMatrix: zeroMatrix,
        timezone: "UTC",
      });
      const service = new SchedulerService(prisma as never);

      const slotA = new Date("2026-06-22T09:00:00.000Z"); // Monday 09:00
      const slotB = new Date("2026-06-22T14:00:00.000Z"); // Monday 14:00
      const idxA = 0 * 24 + 9;
      const idxB = 0 * 24 + 14;

      // Capture every `user.update` call's preferenceMatrix payload as the
      // transaction sees it — this fake gives `this.prisma` (committed) and
      // a transaction's `db` handle genuinely DIFFERENT, diverging views of
      // `preferenceMatrix` (see `makeFakePrisma`'s doc comment), so if
      // `recordEvent`'s read went via `this.prisma` instead of `db`, the
      // SECOND call below would recompute from the stale all-zero committed
      // view and clobber the FIRST call's own in-transaction nudge.
      const seen: number[][] = [];
      await prisma.$transaction(async (tx) => {
        const txWithUser = tx as {
          user: {
            update: (args: {
              data: { preferenceMatrix: number[] };
            }) => Promise<unknown>;
          };
        };
        const originalUpdate = txWithUser.user.update;
        txWithUser.user.update = (args) => {
          seen.push(args.data.preferenceMatrix);
          return originalUpdate(args);
        };
        await service.recordEvent(
          "u1",
          "task-1",
          "KEEP",
          { scheduledStartTime: slotA, durationMinutes: 60 },
          {},
          tx as never,
        );
        await service.recordEvent(
          "u1",
          "task-2",
          "KEEP",
          { scheduledStartTime: slotB, durationMinutes: 60 },
          {},
          tx as never,
        );
      });

      expect(seen).toHaveLength(2);
      // The FIRST write nudges only bucket A.
      expect(seen[0][idxA]).toBeCloseTo(0.1);
      expect(seen[0][idxB]).toBeCloseTo(0);
      // The SECOND write must carry BOTH nudges — proof it read the first
      // call's own in-transaction update rather than the stale committed
      // (all-zero) view.
      expect(seen[1][idxA]).toBeCloseTo(0.1);
      expect(seen[1][idxB]).toBeCloseTo(0.1);
    });
  });
});
