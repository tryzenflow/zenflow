import { TasksService } from "./tasks.service";
import { SchedulerService } from "../scheduler/scheduler.service";
import type { Tag, Task, User } from "../../generated/prisma";
import type { ListTasksDto } from "./dto/list-tasks.dto";
import { deadlineOptions } from "./utils/deadline-options";

/** list()/suggestions() read tasks with their related tags included. */
type TaskWithTags = Task & { tags: Tag[] };

/**
 * Focused coverage for `TasksService`: create/update/displace/resize/remove
 * orchestration, all of which now delegate placement to `SchedulerService.
 * reoptimize` (unit-tested independently in `scheduler.service.spec.ts` and
 * the pure `edf`/`reranker`/`rationale` specs). Most tests here stub the
 * scheduler to assert TasksService's OWN wiring (what it persists immediately
 * vs. defers, how it shapes responses); a few integration-style tests drive a
 * REAL `SchedulerService` over an in-memory task table to prove the inline
 * reoptimize actually runs end-to-end.
 */

// UTC user so a 'YYYY-MM-DD' wall clock maps straight to the same UTC instant.
const user: User = {
  id: "user-1",
  name: "Tester",
  email: "tester@example.com",
  timezone: "UTC",
  workStart: 540,
  workEnd: 1020,
  workDays: [1, 2, 3, 4, 5],
  preferenceMatrix: [],
  preferenceMatrixDecayedAt: null,
  durationAdjustmentMode: "auto",
  onboardingComplete: true,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

function task(overrides: Partial<TaskWithTags> & { id: string }): TaskWithTags {
  return {
    title: "Task",
    note: null,
    durationMinutes: 60,
    deadline: null,
    tags: [],
    manuallyMoved: false,
    startTime: 0,
    status: "PENDING",
    conflict: false,
    scheduledStartTime: null,
    userId: user.id,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function tag(name: string): Tag {
  return {
    id: `tag-${name}`,
    name,
    userId: user.id,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

function makeService(rows: TaskWithTags[]): TasksService {
  const prisma = {
    task: { findMany: jest.fn().mockResolvedValue(rows) },
  };
  // Scheduler is unused by list()/suggestions().
  return new TasksService(prisma as never, {} as never);
}

/** A fresh no-op duration-correction stub per service instance (bias 1.0). */
function makeCorrectionStub(): jest.Mock {
  return jest.fn(
    (
      _userId: string,
      _tags: string[],
      estimatedDuration: number,
    ): Promise<unknown> =>
      Promise.resolve({
        estimatedDuration,
        adjustedDuration: estimatedDuration,
        biasApplied: 1.0,
        durationReason: null,
      }),
  );
}

/**
 * Build a TasksService over an in-memory task table for create(). Captures
 * every `task.create` call so tests can assert exactly how many rows a single
 * POST materializes (must be one — recurrence is gone).
 */
function makeCreateService(): {
  service: TasksService;
  creates: { id: string; data: Record<string, unknown> }[];
  scheduler: {
    prefsOf: jest.Mock;
    reoptimize: jest.Mock;
    computeDurationCorrection: jest.Mock;
    recordEvent: jest.Mock;
  };
} {
  const creates: { id: string; data: Record<string, unknown> }[] = [];
  const byId = new Map<string, TaskWithTags>();

  const tx = {
    tag: {
      createMany: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    },
    task: {
      create: jest.fn((args: { data: Record<string, unknown> }) => {
        const id = `task-${creates.length}`;
        creates.push({ id, data: args.data });
        const row = task({
          id,
          title: (args.data.title as string) ?? "Task",
          durationMinutes: (args.data.durationMinutes as number) ?? 60,
          deadline: (args.data.deadline as Date | null) ?? null,
          scheduledStartTime:
            (args.data.scheduledStartTime as Date | null) ?? null,
        });
        byId.set(id, row);
        return Promise.resolve(row);
      }),
      findUniqueOrThrow: jest.fn((args: { where: { id: string } }) =>
        Promise.resolve(byId.get(args.where.id)!),
      ),
    },
    taskEvent: { create: jest.fn().mockResolvedValue({}) },
  };

  const prisma = {
    $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
  };
  const scheduler = {
    prefsOf: jest.fn(() => ({
      workStart: user.workStart,
      workEnd: user.workEnd,
      workDays: user.workDays,
      timezone: user.timezone,
    })),
    reoptimize: jest.fn().mockResolvedValue({ displaced: [], batchId: null }),
    computeDurationCorrection: makeCorrectionStub(),
    recordEvent: jest.fn().mockResolvedValue(undefined),
  };

  return {
    service: new TasksService(prisma as never, scheduler as never),
    creates,
    scheduler,
  };
}

describe("TasksService.create — single row (no recurrence)", () => {
  it("materializes exactly one Task row per POST", async () => {
    const { service, creates } = makeCreateService();
    await service.create(
      {
        title: "Standup",
        durationMinutes: 30,
        deadline: "2026-06-10T17:00:00.000Z",
      },
      user,
    );
    expect(creates).toHaveLength(1);
  });

  it("creates the task unplaced (scheduledStartTime null) — placement comes from the cascade", async () => {
    const { service, creates } = makeCreateService();
    await service.create(
      {
        title: "Standup",
        durationMinutes: 30,
        deadline: "2026-06-10T17:00:00.000Z",
      },
      user,
    );
    expect(creates[0].data.scheduledStartTime).toBeNull();
    expect(creates[0].data.conflict).toBe(false);
  });

  it("places the new task through the unified reoptimize pass, tagged fixedTaskId so its own CREATE event isn't double-logged", async () => {
    const { service, scheduler } = makeCreateService();
    const now = new Date("2026-06-08T08:00:00.000Z");
    await service.create(
      {
        title: "Standup",
        durationMinutes: 30,
        deadline: "2026-06-15T00:00:00.000Z",
      },
      user,
      now,
    );
    expect(scheduler.reoptimize).toHaveBeenCalledWith(
      user.id,
      expect.anything(),
      now,
      expect.anything(), // tx
      { fixedTaskId: "task-0" },
    );
  });

  it("records a CREATE telemetry event", async () => {
    const { service, scheduler } = makeCreateService();
    await service.create(
      {
        title: "Standup",
        durationMinutes: 30,
        deadline: "2026-06-10T17:00:00.000Z",
      },
      user,
    );
    expect(scheduler.recordEvent).toHaveBeenCalledWith(
      user.id,
      "task-0",
      "CREATE",
      expect.objectContaining({ durationMinutes: 30 }),
      expect.anything(),
      expect.anything(),
    );
  });

  it("comes back unplaced (conflict: true) with no overflow field when the cascade can't place it — the 3-tier fallback lives in the pure scheduler now", async () => {
    const { service } = makeCreateService();
    const result = await service.create(
      {
        title: "Standup",
        durationMinutes: 30,
        deadline: "2026-06-10T17:00:00.000Z",
      },
      user,
    );
    expect(result.task.scheduledStartTime).toBeNull();
    expect(result).not.toHaveProperty("overflow");
  });

  it("returns displaced tasks from the cascade, excluding the new task itself", async () => {
    const { service, scheduler } = makeCreateService();
    scheduler.reoptimize.mockResolvedValueOnce({
      displaced: [
        {
          id: "task-0",
          scheduledStartTime: new Date("2026-06-08T09:00:00Z"),
          conflict: false,
        },
        {
          id: "other",
          scheduledStartTime: new Date("2026-06-08T10:00:00Z"),
          conflict: false,
        },
      ],
      batchId: "batch-1",
    });
    const result = await service.create(
      {
        title: "Standup",
        durationMinutes: 30,
        deadline: "2026-06-10T17:00:00.000Z",
      },
      user,
    );
    expect(result.displaced).toEqual([
      { taskId: "other", newScheduledStartTime: "2026-06-08T10:00:00.000Z" },
    ]);
  });

  it("applies the Phase-2 duration correction only when durationAdjustmentMode !== 'never'", async () => {
    const { service, creates, scheduler } = makeCreateService();
    scheduler.computeDurationCorrection.mockResolvedValueOnce({
      estimatedDuration: 60,
      adjustedDuration: 90,
      biasApplied: 1.5,
      durationReason: "#backend ~50% longer",
    });
    await service.create(
      {
        title: "Corrected",
        durationMinutes: 60,
        deadline: "2026-06-10T17:00:00.000Z",
        tags: ["backend"],
      },
      { ...user, durationAdjustmentMode: "auto" },
    );
    expect(creates[0].data.durationMinutes).toBe(90);
  });

  it("never mode: keeps the typed estimate even though correction is still computed", async () => {
    const { service, creates, scheduler } = makeCreateService();
    scheduler.computeDurationCorrection.mockResolvedValueOnce({
      estimatedDuration: 60,
      adjustedDuration: 90,
      biasApplied: 1.5,
      durationReason: "#backend ~50% longer",
    });
    await service.create(
      {
        title: "Uncorrected",
        durationMinutes: 60,
        deadline: "2026-06-10T17:00:00.000Z",
        tags: ["backend"],
      },
      { ...user, durationAdjustmentMode: "never" },
    );
    expect(scheduler.computeDurationCorrection).toHaveBeenCalled();
    expect(creates[0].data.durationMinutes).toBe(60);
  });
});

/**
 * suggestions() drives a single findMany (ordered createdAt desc) and then
 * dedupes/limits in memory — unchanged from before the rewrite.
 */
function makeSuggestionsService(rows: TaskWithTags[]): {
  service: TasksService;
  findMany: jest.Mock;
} {
  const findMany = jest.fn((args: { where?: Record<string, unknown> }) => {
    const where = args.where ?? {};
    const title = where.title as { contains?: string } | undefined;
    const q = title?.contains?.toLowerCase();
    const filtered = q
      ? rows.filter((r) => r.title.toLowerCase().includes(q))
      : rows;
    return Promise.resolve(filtered);
  });
  const prisma = { task: { findMany } };
  return { service: new TasksService(prisma as never, {} as never), findMany };
}

describe("TasksService.suggestions — title autocomplete", () => {
  const at = (iso: string) => new Date(iso);

  it("returns tasks newest-first, deduped by title, limited", async () => {
    const rows = [
      task({
        id: "c",
        title: "Charlie",
        createdAt: at("2026-03-03T00:00:00Z"),
      }),
      task({
        id: "b",
        title: "charlie",
        createdAt: at("2026-02-02T00:00:00Z"),
      }),
      task({ id: "a", title: "Alpha", createdAt: at("2026-01-01T00:00:00Z") }),
    ];
    const { service } = makeSuggestionsService(rows);
    const res = await service.suggestions({ limit: 10 }, user);
    expect(res.suggestions.map((s) => s.id)).toEqual(["c", "a"]);
  });

  it("filters by title substring, case-insensitively", async () => {
    const rows = [
      task({
        id: "1",
        title: "Write REPORT",
        createdAt: at("2026-03-03T00:00:00Z"),
      }),
      task({
        id: "2",
        title: "Email team",
        createdAt: at("2026-02-02T00:00:00Z"),
      }),
    ];
    const { service, findMany } = makeSuggestionsService(rows);
    await service.suggestions({ q: "report", limit: 10 }, user);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: user.id,
          title: { contains: "report", mode: "insensitive" },
        },
      }),
    );
  });
});

describe("TasksService.list — display vs focal window", () => {
  describe("month view", () => {
    const dto: ListTasksDto = { view: "month", date: "2026-06-15" };

    const focalTask = task({
      id: "focal",
      durationMinutes: 90,
      scheduledStartTime: new Date("2026-06-15T10:00:00.000Z"),
    });
    const nextMonthEdge = task({
      id: "next-edge",
      durationMinutes: 120,
      scheduledStartTime: new Date("2026-07-02T10:00:00.000Z"),
    });
    const farNextMonth = task({
      id: "far-next",
      durationMinutes: 45,
      scheduledStartTime: new Date("2026-07-20T10:00:00.000Z"),
    });

    it("renders next-month grid-edge tasks but excludes them from meta", async () => {
      const service = makeService([focalTask, nextMonthEdge, farNextMonth]);
      const res = await service.list(dto, user);
      expect(res.tasks.map((t) => t.id).sort()).toEqual(["focal", "next-edge"]);
      expect(res.meta.totalAllocatedMinutes).toBe(90);
    });

    it("maps related Tag rows to a sorted name array on the DTO", async () => {
      const tagged = task({
        id: "tagged",
        scheduledStartTime: new Date("2026-06-15T10:00:00.000Z"),
        tags: [tag("work"), tag("admin")],
      });
      const service = makeService([tagged]);
      const res = await service.list(dto, user);
      expect(res.tasks.find((t) => t.id === "tagged")?.tags).toEqual([
        "admin",
        "work",
      ]);
    });

    it("still surfaces unplaced conflicts everywhere", async () => {
      const unplaced = task({ id: "unplaced", conflict: true });
      const service = makeService([unplaced]);
      const res = await service.list(dto, user);
      expect(res.tasks.map((t) => t.id)).toEqual(["unplaced"]);
      expect(res.meta.conflictCount).toBe(1);
    });
  });

  describe("week view (unchanged — no padding)", () => {
    const dto: ListTasksDto = { view: "week", date: "2026-06-10" };

    it("does NOT return an adjacent-week task", async () => {
      const inWeek = task({
        id: "in-week",
        scheduledStartTime: new Date("2026-06-10T10:00:00.000Z"),
      });
      const nextWeek = task({
        id: "next-week",
        scheduledStartTime: new Date("2026-06-16T10:00:00.000Z"),
      });
      const service = makeService([inWeek, nextWeek]);
      const res = await service.list(dto, user);
      expect(res.tasks.map((t) => t.id)).toEqual(["in-week"]);
    });
  });
});

/**
 * Build a TasksService over an in-memory task table with a fully mocked
 * SchedulerService, for update() tests that assert TasksService's OWN
 * orchestration (what it saves immediately, what it defers to reoptimize).
 */
function makeUpdateService(rows: TaskWithTags[]): {
  service: TasksService;
  table: Map<string, TaskWithTags>;
  scheduler: {
    prefsOf: jest.Mock;
    reoptimize: jest.Mock;
    computeDurationCorrection: jest.Mock;
    recordEvent: jest.Mock;
  };
} {
  const table = new Map<string, TaskWithTags>(rows.map((r) => [r.id, r]));

  const tx = {
    task: {
      findFirst: jest.fn((args: { where: { id: string } }) =>
        Promise.resolve(table.get(args.where.id) ?? null),
      ),
      findUniqueOrThrow: jest.fn((args: { where: { id: string } }) =>
        Promise.resolve(table.get(args.where.id)!),
      ),
      update: jest.fn(
        (args: {
          where: { id: string };
          data: Record<string, unknown> & { tags?: { set: { id: string }[] } };
        }) => {
          const row = table.get(args.where.id)!;
          const { tags: tagsOp, ...scalar } = args.data;
          // Mirror real Prisma semantics: an explicit `undefined` value means
          // "don't touch this column," not "set it to undefined."
          const definedScalar = Object.fromEntries(
            Object.entries(scalar).filter(([, v]) => v !== undefined),
          );
          const next = {
            ...row,
            ...definedScalar,
            ...(tagsOp
              ? { tags: tagsOp.set.map((t) => tag(t.id.replace(/^tag-/, ""))) }
              : {}),
          } as TaskWithTags;
          table.set(args.where.id, next);
          return Promise.resolve(next);
        },
      ),
    },
    tag: {
      createMany: jest.fn().mockResolvedValue({}),
      findMany: jest.fn((args: { where: { name: { in: string[] } } }) =>
        Promise.resolve(args.where.name.in.map((name) => tag(name))),
      ),
    },
  };

  const prisma = { $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) };

  const scheduler = {
    prefsOf: jest.fn(() => ({
      workStart: user.workStart,
      workEnd: user.workEnd,
      workDays: user.workDays,
      timezone: user.timezone,
    })),
    reoptimize: jest.fn().mockResolvedValue({ displaced: [], batchId: null }),
    computeDurationCorrection: makeCorrectionStub(),
    recordEvent: jest.fn().mockResolvedValue(undefined),
  };

  return {
    service: new TasksService(prisma as never, scheduler as never),
    table,
    scheduler,
  };
}

describe("TasksService.update — metadata-only", () => {
  it("saves a deadline change immediately; skips the reoptimize pass for a task already in the past", async () => {
    const existing = task({
      id: "t1",
      deadline: new Date("2026-06-10T17:00:00Z"),
      scheduledStartTime: new Date("2026-06-08T09:00:00Z"),
    });
    const { service, table, scheduler } = makeUpdateService([existing]);

    const res = await service.update(
      "t1",
      { deadline: "2026-06-09T17:00:00.000Z" },
      user,
      new Date("2026-06-08T10:00:00Z"), // "now" — after the task's own start
    );

    expect(table.get("t1")!.deadline?.toISOString()).toBe(
      "2026-06-09T17:00:00.000Z",
    );
    expect(scheduler.reoptimize).not.toHaveBeenCalled();
    expect(res.task.scheduledStartTime).toBe("2026-06-08T09:00:00.000Z");
    expect(res.deadlineChanged).toBe(true);
  });

  it("omits deadlineChanged when the deadline is untouched or unchanged", async () => {
    const existing = task({
      id: "t1",
      deadline: new Date("2026-06-10T17:00:00Z"),
    });
    const { service } = makeUpdateService([existing]);

    const untouched = await service.update("t1", { title: "Renamed" }, user);
    expect(untouched.deadlineChanged).toBeUndefined();

    const same = await service.update(
      "t1",
      { deadline: "2026-06-10T17:00:00.000Z" },
      user,
    );
    expect(same.deadlineChanged).toBeUndefined();
  });

  it("does not compute schedulingMeta when tags are untouched", async () => {
    const existing = task({ id: "t1" });
    const { service, scheduler } = makeUpdateService([existing]);

    const res = await service.update("t1", { title: "Renamed" }, user);

    expect(scheduler.computeDurationCorrection).not.toHaveBeenCalled();
    expect(res.schedulingMeta).toBeUndefined();
  });

  it("applies the tag-driven duration correction immediately (mode != 'never')", async () => {
    const existing = task({ id: "t1", durationMinutes: 60 });
    const { service, table, scheduler } = makeUpdateService([existing]);
    scheduler.computeDurationCorrection.mockResolvedValueOnce({
      estimatedDuration: 60,
      adjustedDuration: 90,
      biasApplied: 1.5,
      durationReason: "#backend ~50% longer",
    });

    const res = await service.update("t1", { tags: ["backend"] }, user);

    expect(res.schedulingMeta).toEqual(
      expect.objectContaining({ adjustedDuration: 90, biasApplied: 1.5 }),
    );
    expect(table.get("t1")!.durationMinutes).toBe(90);
  });

  it("leaves the stored duration untouched when durationAdjustmentMode is 'never'", async () => {
    const existing = task({ id: "t1", durationMinutes: 60 });
    const { service, table, scheduler } = makeUpdateService([existing]);
    scheduler.computeDurationCorrection.mockResolvedValueOnce({
      estimatedDuration: 60,
      adjustedDuration: 90,
      biasApplied: 1.5,
      durationReason: "#backend ~50% longer",
    });

    const res = await service.update(
      "t1",
      { tags: ["backend"] },
      { ...user, durationAdjustmentMode: "never" },
    );

    // Still surfaced informationally, but reflects the UNCHANGED duration.
    expect(res.schedulingMeta).toEqual(
      expect.objectContaining({ adjustedDuration: 60 }),
    );
    expect(table.get("t1")!.durationMinutes).toBe(60);
  });
});

describe("deadlineOptions (pure) — used directly by TasksController", () => {
  it("returns six ISO chip values derived from horizon ceiling math", () => {
    const res = deadlineOptions("2026-06-08T10:00:00.000Z", user); // Monday
    // "Today" is the day CEILING (midnight), not the work-hours end.
    expect(res.today).toBe("2026-06-09T00:00:00.000Z");
    // "Tomorrow" is explicitly tomorrow's WORK-HOURS end (todo.md).
    expect(res.tomorrow).toBe("2026-06-09T17:00:00.000Z");
    // ISO week (Mon-Sun) ceiling → next Monday 00:00.
    expect(res.thisWeek).toBe("2026-06-15T00:00:00.000Z");
    expect(res.nextWeek).toBe("2026-06-22T00:00:00.000Z");
    expect(res.thisMonth).toBe("2026-07-01T00:00:00.000Z");
    expect(res.noRush).toBe("2026-08-01T00:00:00.000Z");
  });
});

/**
 * Integration-style coverage driven with a REAL SchedulerService over an
 * in-memory task table, so the actual cascade wiring (not just the mock call
 * shape) is exercised for the highest-value flows: delete's gap-fill and the
 * pin-and-cascade drag/resize path.
 */
function makeIntegrationService(rows: TaskWithTags[]): {
  service: TasksService;
  table: Map<string, TaskWithTags>;
  taskEventCreate: jest.Mock;
  taskEventCreateMany: jest.Mock;
  userUpdate: jest.Mock;
} {
  const table = new Map<string, TaskWithTags>(rows.map((r) => [r.id, r]));
  let nextId = 0;
  // Backs the fake `taskEvent.create`/`createMany`/`findMany` below — a real
  // in-memory store so `undoBatch`'s `findMany({ where: { userId, batchId }
  // })` can find what `reoptimize` actually wrote.
  const events: Record<string, unknown>[] = [];

  const matchesStatus = (t: TaskWithTags, filter: unknown): boolean => {
    if (filter === undefined) return true;
    if (typeof filter === "string") return t.status === filter;
    const notFilter = filter as { not?: string };
    if (notFilter && typeof notFilter === "object" && "not" in notFilter)
      return t.status !== notFilter.not;
    return true;
  };
  const matchesScheduledStartTime = (
    t: TaskWithTags,
    clause: unknown,
  ): boolean => {
    if (clause === null) return t.scheduledStartTime === null;
    if (t.scheduledStartTime === null) return false;
    const range = clause as { gte?: Date; lte?: Date };
    const time = t.scheduledStartTime.getTime();
    if (range.gte && time < range.gte.getTime()) return false;
    if (range.lte && time > range.lte.getTime()) return false;
    return true;
  };
  const matchesWhere = (
    t: TaskWithTags,
    where: Record<string, unknown> | undefined,
  ): boolean => {
    if (!where) return true;
    if (where.id !== undefined && t.id !== where.id) return false;
    if (where.userId !== undefined && t.userId !== where.userId) return false;
    if (!matchesStatus(t, where.status)) return false;
    if (where.OR !== undefined) {
      const clauses = where.OR as { scheduledStartTime?: unknown }[];
      if (
        !clauses.some((c) => matchesScheduledStartTime(t, c.scheduledStartTime))
      )
        return false;
    }
    return true;
  };

  const tx = {
    task: {
      findFirst: jest.fn((args: { where?: Record<string, unknown> }) =>
        Promise.resolve(
          [...table.values()].find((t) => matchesWhere(t, args.where)) ?? null,
        ),
      ),
      findUnique: jest.fn((args: { where?: Record<string, unknown> }) =>
        Promise.resolve(
          [...table.values()].find((t) => matchesWhere(t, args.where)) ?? null,
        ),
      ),
      findMany: jest.fn((args: { where?: Record<string, unknown> }) =>
        Promise.resolve(
          [...table.values()].filter((t) => matchesWhere(t, args.where)),
        ),
      ),
      findUniqueOrThrow: jest.fn((args: { where: { id: string } }) =>
        Promise.resolve(table.get(args.where.id)!),
      ),
      update: jest.fn(
        (args: { where: { id: string }; data: Record<string, unknown> }) => {
          const row = table.get(args.where.id)!;
          const next = { ...row, ...args.data } as TaskWithTags;
          table.set(args.where.id, next);
          return Promise.resolve(next);
        },
      ),
      delete: jest.fn((args: { where: { id: string } }) => {
        const row = table.get(args.where.id)!;
        table.delete(args.where.id);
        return Promise.resolve(row);
      }),
      create: jest.fn((args: { data: Record<string, unknown> }) => {
        const id = `new-${nextId++}`;
        const row = task({
          id,
          title: (args.data.title as string) ?? "Task",
          durationMinutes: (args.data.durationMinutes as number) ?? 60,
          deadline: (args.data.deadline as Date | null) ?? null,
          scheduledStartTime:
            (args.data.scheduledStartTime as Date | null) ?? null,
          conflict: (args.data.conflict as boolean) ?? false,
        });
        table.set(id, row);
        return Promise.resolve(row);
      }),
    },
    tag: {
      createMany: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    },
    // reoptimize reads the user's preference matrix to re-rank candidates;
    // cold-start (empty matrix) keeps this integration coverage earliest-
    // first, matching every existing assertion below.
    user: {
      findUniqueOrThrow: jest
        .fn()
        .mockResolvedValue({ preferenceMatrix: user.preferenceMatrix }),
      update: jest.fn().mockResolvedValue({}),
    },
    taskEvent: {
      // A real in-memory store (not just a call-tracking stub) so
      // `SchedulerService.undoBatch`'s `findMany({ where: { userId, batchId
      // } })` can actually find what `reoptimize` wrote — needed for the
      // undo-integration tests below.
      create: jest.fn((args: { data: Record<string, unknown> }) => {
        events.push({ ...args.data });
        return Promise.resolve(args.data);
      }),
      createMany: jest.fn((args: { data: Record<string, unknown>[] }) => {
        events.push(...args.data.map((d) => ({ ...d })));
        return Promise.resolve({ count: args.data.length });
      }),
      findMany: jest.fn((args: { where?: Record<string, unknown> }) => {
        const where = args.where ?? {};
        return Promise.resolve(
          events.filter((e) => {
            if (where.userId !== undefined && e.userId !== where.userId)
              return false;
            if (where.batchId !== undefined && e.batchId !== where.batchId)
              return false;
            return true;
          }),
        );
      }),
    },
    /**
     * Fans out to whichever shape the caller's raw UPDATE used (detected from
     * the fixed SQL text around the `VALUES` interpolation):
     *  - `persistPlacements`: a flat run of (id, scheduledStartTime,
     *    conflict, manuallyMoved).
     *  - `SchedulerService.undoBatch`'s restore step: a flat run of (id,
     *    scheduledStartTime, durationMinutes) — always also forces
     *    manuallyMoved: false.
     * Changing either tuple order means changing this decode.
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
    $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
    ...tx,
  };

  const scheduler = new SchedulerService(prisma as never);
  const service = new TasksService(prisma as never, scheduler);
  return {
    service,
    table,
    taskEventCreate: tx.taskEvent.create,
    taskEventCreateMany: tx.taskEvent.createMany,
    userUpdate: tx.user.update,
  };
}

describe("TasksService.create — real scheduler, can legitimately displace a far-out task", () => {
  it("nudges a far-anchored, cost-cheap-to-move task out of the way when placing the new task well requires it", async () => {
    const day = "2030-06-17"; // Monday
    const farDay = "2030-06-27"; // Thursday, +10 days — beyond the deviation horizon
    const now = new Date(`${day}T08:00:00.000Z`);
    const addDays = (iso: string, n: number): string =>
      new Date(new Date(`${iso}T00:00:00.000Z`).getTime() + n * 86_400_000)
        .toISOString()
        .slice(0, 10);

    // Block every workday strictly between "day" and "farDay" (weekend
    // offsets need no wall — nothing gets scheduled on a non-work day
    // anyway) so the new task's earliest-feasible search can't just grab an
    // early, unrelated day — it has to reach the far task's own day to find
    // room.
    const walls = [0, 1, 2, 3, 4, 7, 8, 9].map((offset) => {
      const d = addDays(day, offset);
      return task({
        id: `wall-${offset}`,
        deadline: new Date(`${d}T17:00:00.000Z`),
        durationMinutes: 480,
        scheduledStartTime: new Date(`${d}T09:00:00.000Z`),
      });
    });
    const far = task({
      id: "far",
      durationMinutes: 60,
      scheduledStartTime: new Date(`${farDay}T09:00:00.000Z`),
    });
    const { service, table } = makeIntegrationService([...walls, far]);

    const result = await service.create(
      {
        title: "Urgent",
        durationMinutes: 60,
        deadline: new Date(`${farDay}T10:00:00.000Z`).toISOString(),
      },
      user,
      now,
    );

    // The new task gets the slot it needed...
    expect(result.task.scheduledStartTime).toBe(`${farDay}T09:00:00.000Z`);
    // ...and the far-anchored task — cheap to renegotiate given how far in
    // the future it sits — gave it up, rather than the create silently
    // failing to find room or leaving a conflict. This is the OLD "create
    // never displaces anything" guarantee being deliberately gone.
    expect(table.get("far")!.scheduledStartTime?.toISOString()).not.toBe(
      `${farDay}T09:00:00.000Z`,
    );
    expect(result.displaced.some((d) => d.taskId === "far")).toBe(true);
  });
});

describe("TasksService.remove", () => {
  it("deletes the row, leaving an unrelated task's placement untouched when nothing contests it", async () => {
    const day = "2030-06-17"; // a Monday (workday)
    const fixedBlock = task({
      id: "fixed-block",
      manuallyMoved: true,
      durationMinutes: 120,
      scheduledStartTime: new Date(`${day}T09:00:00.000Z`),
    });
    const flexible = task({
      id: "flexible",
      durationMinutes: 60,
      scheduledStartTime: new Date(`${day}T11:00:00.000Z`),
    });
    const { service, table } = makeIntegrationService([fixedBlock, flexible]);

    await service.remove("fixed-block", user, new Date(`${day}T08:00:00.000Z`));

    expect(table.has("fixed-block")).toBe(false);
    // Nothing else wants "flexible"'s slot, so 0 deviation cost keeps it
    // exactly where it already was — staying is always at least as cheap as
    // moving when nothing is contested.
    expect(table.get("flexible")!.scheduledStartTime?.toISOString()).toBe(
      `${day}T11:00:00.000Z`,
    );
  });

  it("closes the gap it leaves behind inline — no separate confirm step", async () => {
    const day = "2030-06-17"; // Monday
    const farDay = "2030-06-27"; // 10 days out — beyond the deviation horizon
    const fixedBlock = task({
      id: "fixed-block",
      durationMinutes: 30,
      scheduledStartTime: new Date(`${farDay}T09:00:00.000Z`),
    });
    // Currently off-hours (before the 09:00 work start) on the SAME far day —
    // its cheapest legitimate improvement is the slot "fixed-block" is
    // sitting on, but it can't have it until "fixed-block" is gone.
    const flexible = task({
      id: "flexible",
      durationMinutes: 30,
      scheduledStartTime: new Date(`${farDay}T08:00:00.000Z`),
    });
    const { service, table } = makeIntegrationService([fixedBlock, flexible]);

    await service.remove("fixed-block", user, new Date(`${day}T08:00:00.000Z`));

    expect(table.has("fixed-block")).toBe(false);
    expect(table.get("flexible")!.scheduledStartTime?.toISOString()).toBe(
      `${farDay}T09:00:00.000Z`,
    );
  });
});

describe("TasksService.displace / resize — pin + inline reoptimize", () => {
  const day = "2030-06-17"; // Monday
  const now = new Date(`${day}T08:00:00.000Z`);

  it("displace() pins the task manuallyMoved at the requested slot", async () => {
    const moved = task({
      id: "a",
      durationMinutes: 60,
      scheduledStartTime: new Date(`${day}T09:00:00.000Z`),
    });
    const { service, table, taskEventCreate } = makeIntegrationService([moved]);

    await service.displace("a", `${day}T14:00:00.000Z`, user, now);

    expect(table.get("a")!.manuallyMoved).toBe(true);
    expect(table.get("a")!.scheduledStartTime?.toISOString()).toBe(
      `${day}T14:00:00.000Z`,
    );
    // A real user drag now produces MOVE telemetry.
    expect(taskEventCreate).toHaveBeenCalled();
    const moveCalls = taskEventCreate.mock.calls as {
      data: { eventType: string; taskId: string };
    }[][];
    expect(moveCalls[0][0].data.eventType).toBe("MOVE");
    expect(moveCalls[0][0].data.taskId).toBe("a");
  });

  it("resize() updates duration and pins manuallyMoved", async () => {
    const resized = task({
      id: "a",
      durationMinutes: 60,
      scheduledStartTime: new Date(`${day}T09:00:00.000Z`),
    });
    const { service, table, taskEventCreate } = makeIntegrationService([
      resized,
    ]);

    await service.resize("a", `${day}T09:00:00.000Z`, 120, user, now);

    expect(table.get("a")!.durationMinutes).toBe(120);
    expect(table.get("a")!.manuallyMoved).toBe(true);
    // A real user resize now produces RESIZE telemetry.
    expect(taskEventCreate).toHaveBeenCalled();
    const resizeCalls = taskEventCreate.mock.calls as {
      data: { eventType: string; taskId: string };
    }[][];
    expect(resizeCalls[0][0].data.eventType).toBe("RESIZE");
    expect(resizeCalls[0][0].data.taskId).toBe("a");
  });

  it("manuallyMoved grants a neighbor NO special protection anymore — displace() can evict it too, when cost-favorable", async () => {
    const dragged = task({
      id: "a",
      durationMinutes: 60,
      // A tighter deadline than "b"'s (below) puts "a" first in EDF order —
      // matching what the drag itself already established: this is the task
      // the user is actively acting on.
      deadline: new Date(`${day}T16:00:00.000Z`),
      scheduledStartTime: new Date(`${day}T13:00:00.000Z`),
    });
    // The dragged task lands right on top of this one, which happens to be
    // manually-moved — under the old hard freeze this was untouchable; under
    // the continuous cost model it's just another task with an anchor.
    const other = task({
      id: "b",
      manuallyMoved: true,
      deadline: new Date(`${day}T17:00:00.000Z`),
      durationMinutes: 60,
      scheduledStartTime: new Date(`${day}T09:00:00.000Z`),
      conflict: false,
    });
    const { service, table } = makeIntegrationService([dragged, other]);

    const res = await service.displace("a", `${day}T09:00:00.000Z`, user, now);

    // "a" claims the exact slot it was dropped on.
    expect(table.get("a")!.scheduledStartTime?.toISOString()).toBe(
      `${day}T09:00:00.000Z`,
    );
    expect(table.get("a")!.conflict).toBe(false);
    // "b" reflows out of the way, and — having actually been relocated by
    // the algorithm rather than the user — its manual pin is cleared.
    expect(table.get("b")!.scheduledStartTime?.toISOString()).toBe(
      `${day}T10:00:00.000Z`,
    );
    expect(table.get("b")!.manuallyMoved).toBe(false);
    expect(table.get("b")!.conflict).toBe(false);
    expect(res.displaced).toEqual([
      { taskId: "b", newScheduledStartTime: `${day}T10:00:00.000Z` },
    ]);
    expect(res.batchId).toEqual(expect.any(String));
  });

  it("displace() pushes an auto-scheduled neighbor out of the way instead of leaving conflict: true", async () => {
    const dragged = task({
      id: "a",
      durationMinutes: 60,
      // A tighter deadline than "b"'s (below) puts "a" first in EDF order —
      // matching what the drag itself already established: this is the task
      // the user is actively acting on.
      deadline: new Date(`${day}T16:00:00.000Z`),
      scheduledStartTime: new Date(`${day}T13:00:00.000Z`),
    });
    // An ordinary auto-scheduled (non-manual) neighbor sitting right where
    // the drag lands.
    const neighbor = task({
      id: "b",
      manuallyMoved: false,
      durationMinutes: 60,
      deadline: new Date(`${day}T17:00:00.000Z`),
      scheduledStartTime: new Date(`${day}T09:00:00.000Z`),
      conflict: false,
    });
    const { service, table } = makeIntegrationService([dragged, neighbor]);

    const res = await service.displace("a", `${day}T09:00:00.000Z`, user, now);

    // The dragged task lands exactly where requested.
    expect(table.get("a")!.scheduledStartTime?.toISOString()).toBe(
      `${day}T09:00:00.000Z`,
    );
    expect(table.get("a")!.conflict).toBe(false);
    // The neighbor reflowed out of the way instead of staying in conflict.
    expect(table.get("b")!.scheduledStartTime?.toISOString()).toBe(
      `${day}T10:00:00.000Z`,
    );
    expect(table.get("b")!.conflict).toBe(false);
    expect(res.displaced).toEqual([
      { taskId: "b", newScheduledStartTime: `${day}T10:00:00.000Z` },
    ]);
    expect(res.batchId).toEqual(expect.any(String));
  });

  it("resize() pushes an auto-scheduled neighbor out of the way instead of leaving conflict: true", async () => {
    const resized = task({
      id: "a",
      durationMinutes: 60,
      scheduledStartTime: new Date(`${day}T09:00:00.000Z`),
    });
    const neighbor = task({
      id: "b",
      manuallyMoved: false,
      durationMinutes: 60,
      deadline: new Date(`${day}T17:00:00.000Z`),
      scheduledStartTime: new Date(`${day}T10:00:00.000Z`),
      conflict: false,
    });
    const { service, table } = makeIntegrationService([resized, neighbor]);

    // Growing "a" to 90 minutes now reaches into "b"'s 10:00-11:00 slot.
    const res = await service.resize(
      "a",
      `${day}T09:00:00.000Z`,
      90,
      user,
      now,
    );

    expect(table.get("a")!.durationMinutes).toBe(90);
    expect(table.get("a")!.conflict).toBe(false);
    expect(table.get("b")!.scheduledStartTime?.toISOString()).toBe(
      `${day}T10:30:00.000Z`,
    );
    expect(table.get("b")!.conflict).toBe(false);
    expect(res.displaced).toEqual([
      { taskId: "b", newScheduledStartTime: `${day}T10:30:00.000Z` },
    ]);
    expect(res.batchId).toEqual(expect.any(String));
  });
});

describe("TasksService.update — inline reoptimize (no second call)", () => {
  it("a deadline edit that leaves the task's own slot in conflict auto-resolves the neighbor inline", async () => {
    const day = "2030-06-17"; // Monday
    const anchor = task({
      id: "a",
      durationMinutes: 60,
      deadline: new Date(`${day}T12:00:00.000Z`),
      scheduledStartTime: new Date(`${day}T09:00:00.000Z`),
    });
    // A neighbor that only conflicts with "a" AFTER some other state change —
    // here we simulate "the edit revealed a conflict" by having the neighbor
    // already overlap "a"'s (unchanged) slot; update() must resolve it
    // inline, in the SAME call, without a separate reschedule-cascade.
    const neighbor = task({
      id: "b",
      manuallyMoved: false,
      durationMinutes: 60,
      deadline: new Date(`${day}T17:00:00.000Z`),
      scheduledStartTime: new Date(`${day}T09:30:00.000Z`), // overlaps "a"
      conflict: true,
    });
    const { service, table } = makeIntegrationService([anchor, neighbor]);

    const res = await service.update(
      "a",
      { deadline: new Date(`${day}T13:00:00.000Z`).toISOString() },
      user,
      new Date(`${day}T08:00:00.000Z`), // "now" — both tasks are still future
    );

    // "a" itself never moves — update() only ever touches its metadata.
    expect(table.get("a")!.scheduledStartTime?.toISOString()).toBe(
      `${day}T09:00:00.000Z`,
    );
    // The neighbor reflowed out of the way, inline, in this same call.
    expect(table.get("b")!.scheduledStartTime?.toISOString()).toBe(
      `${day}T10:00:00.000Z`,
    );
    expect(res.deadlineChanged).toBe(true);
    expect(res.displaced).toEqual([
      { taskId: "b", newScheduledStartTime: `${day}T10:00:00.000Z` },
    ]);
    expect(res.batchId).toEqual(expect.any(String));
  });

  it("actually relocates the edited task when a tightened deadline no longer fits its current slot — the bug this redesign fixes", async () => {
    const day = "2030-06-17"; // Monday
    const anchor = task({
      id: "a",
      durationMinutes: 60,
      scheduledStartTime: new Date(`${day}T14:00:00.000Z`),
    });
    const { service, table } = makeIntegrationService([anchor]);

    const res = await service.update(
      "a",
      { deadline: new Date(`${day}T13:00:00.000Z`).toISOString() }, // before its own current end (15:00)
      user,
      new Date(`${day}T08:00:00.000Z`),
    );

    const finalStart = table.get("a")!.scheduledStartTime!;
    expect(finalStart.toISOString()).not.toBe(`${day}T14:00:00.000Z`);
    // Relocated to a slot that respects the NEW deadline.
    expect(finalStart.getTime() + 60 * 60_000).toBeLessThanOrEqual(
      new Date(`${day}T13:00:00.000Z`).getTime(),
    );
    // The response's `task` reflects the FINAL slot, not the pre-reoptimize one.
    expect(res.task.scheduledStartTime).toBe(finalStart.toISOString());
    expect(res.deadlineChanged).toBe(true);
  });

  it("does not attempt a resolve when neither the deadline nor the duration changed", async () => {
    const day = "2030-06-17";
    const anchor = task({
      id: "a",
      durationMinutes: 60,
      scheduledStartTime: new Date(`${day}T09:00:00.000Z`),
    });
    const { service } = makeIntegrationService([anchor]);

    const res = await service.update("a", { title: "Renamed" }, user);

    expect(res.displaced).toEqual([]);
    expect(res.batchId).toBeUndefined();
  });

  it("skips the resolve for a task already in the past", async () => {
    const day = "2020-06-15"; // Monday, safely in the past
    const anchor = task({
      id: "a",
      durationMinutes: 60,
      deadline: new Date(`${day}T12:00:00.000Z`),
      scheduledStartTime: new Date(`${day}T09:00:00.000Z`),
    });
    const { service, table } = makeIntegrationService([anchor]);

    const res = await service.update(
      "a",
      { deadline: new Date(`${day}T13:00:00.000Z`).toISOString() },
      user,
      new Date(`${day}T10:00:00.000Z`), // "now" is after the task's own start
    );

    expect(res.deadlineChanged).toBe(true);
    expect(res.displaced).toEqual([]);
    expect(table.get("a")!.scheduledStartTime?.toISOString()).toBe(
      `${day}T09:00:00.000Z`,
    );
  });
});

describe("TasksService.undoBatch", () => {
  it("reverts a reoptimize auto-cascade's displaced task back to its prior slot", async () => {
    const day = "2030-06-17"; // Monday
    const dragged = task({
      id: "a",
      durationMinutes: 60,
      // Tighter deadline than "b"'s puts "a" first in EDF order.
      deadline: new Date(`${day}T16:00:00.000Z`),
      scheduledStartTime: new Date(`${day}T13:00:00.000Z`),
    });
    const neighbor = task({
      id: "b",
      manuallyMoved: false,
      durationMinutes: 60,
      deadline: new Date(`${day}T17:00:00.000Z`),
      scheduledStartTime: new Date(`${day}T09:00:00.000Z`),
      conflict: false,
    });
    const { service, table } = makeIntegrationService([dragged, neighbor]);

    const displaceResult = await service.displace(
      "a",
      `${day}T09:00:00.000Z`,
      user,
      new Date(`${day}T08:00:00.000Z`),
    );
    expect(table.get("b")!.scheduledStartTime?.toISOString()).toBe(
      `${day}T10:00:00.000Z`,
    );
    expect(displaceResult.batchId).toEqual(expect.any(String));

    const undone = await service.undoBatch(displaceResult.batchId!, user);

    expect(table.get("b")!.scheduledStartTime?.toISOString()).toBe(
      `${day}T09:00:00.000Z`,
    );
    expect(undone.displaced).toEqual([
      { taskId: "b", newScheduledStartTime: `${day}T09:00:00.000Z` },
    ]);
  });

  it("throws NotFoundException for a batchId that matches no event", async () => {
    const { service } = makeIntegrationService([]);
    await expect(service.undoBatch("nonexistent-batch", user)).rejects.toThrow(
      "Cannot find reschedule batch with id nonexistent-batch",
    );
  });
});

describe("TasksService.complete", () => {
  it("marks the task DONE and writes a COMPLETE event", async () => {
    const done = task({
      id: "a",
      scheduledStartTime: new Date("2026-06-08T09:00:00Z"),
    });
    const { service, table } = makeIntegrationService([done]);

    const result = await service.complete("a", user);

    expect(table.get("a")!.status).toBe("DONE");
    expect(result.status).toBe("DONE");
  });
});
