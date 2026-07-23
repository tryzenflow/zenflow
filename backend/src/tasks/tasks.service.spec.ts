import { TasksService } from "./tasks.service";
import { SchedulerService } from "../scheduler/scheduler.service";
import type { Tag, Task, User } from "../../generated/prisma";
import type { ListTasksDto } from "./dto/list-tasks.dto";
import { deadlineOptions } from "./utils/deadline-options";
import { MAX_SCAN_DAYS } from "../scheduler/constants";

/** list()/suggestions() read tasks with their related tags included. */
type TaskWithTags = Task & { tags: Tag[] };

/**
 * Focused coverage for `TasksService`: create/update/resolvePlacement/
 * displace/resize/remove/complete/undoBatch/optimize orchestration. Most
 * `create`/`update` tests stub `SchedulerService` to assert TasksService's
 * OWN wiring (what it persists immediately vs. delegates, how it shapes
 * responses); the trickier flows (drag/resize conflict acceptance, delete/
 * complete's bounded conflict-clear, resolvePlacement, Optimize) are driven
 * against a REAL `SchedulerService` over an in-memory task table so the
 * actual end-to-end behavior — not just the mock call shape — is exercised.
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

/* ---------------------------------------------------------------------- *
 * Generic fake-Prisma `where` matchers (mirrors scheduler.service.spec.ts's
 * — both fakes model the exact same handful of query shapes the two
 * services issue against `Task`/`TaskEvent`).
 * ---------------------------------------------------------------------- */

interface MinimalTaskRow {
  id: string;
  userId: string;
  status: string;
  scheduledStartTime: Date | null;
}

function matchesStatus(t: MinimalTaskRow, filter: unknown): boolean {
  if (filter === undefined) return true;
  if (typeof filter === "string") return t.status === filter;
  const notFilter = filter as { not?: string };
  if (notFilter && typeof notFilter === "object" && "not" in notFilter)
    return t.status !== notFilter.not;
  return true;
}

function matchesId(t: MinimalTaskRow, clause: unknown): boolean {
  if (clause === undefined) return true;
  if (typeof clause === "string") return t.id === clause;
  const c = clause as { not?: string; in?: string[] };
  if (c.not !== undefined && t.id === c.not) return false;
  if (c.in !== undefined && !c.in.includes(t.id)) return false;
  return true;
}

function matchesScheduledStartTime(
  t: MinimalTaskRow,
  clause: unknown,
): boolean {
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
  t: MinimalTaskRow,
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

function makeService(rows: TaskWithTags[]): TasksService {
  const prisma = {
    task: {
      findMany: jest.fn((args: { where?: Record<string, unknown> }) =>
        Promise.resolve(rows.filter((r) => matchesWhere(r, args.where))),
      ),
    },
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
 * Build a TasksService over an in-memory task table for create(), with a
 * STUBBED `SchedulerService.placeNewTask` (unit-level: asserts TasksService's
 * OWN wiring, not the real tiered-placement math — that's `place.spec.ts` +
 * `scheduler.service.spec.ts`'s job).
 */
function makeCreateService(): {
  service: TasksService;
  creates: { id: string; data: Record<string, unknown> }[];
  updates: { id: string; data: Record<string, unknown> }[];
  scheduler: {
    prefsOf: jest.Mock;
    placeNewTask: jest.Mock;
    computeDurationCorrection: jest.Mock;
    recordEvent: jest.Mock;
  };
} {
  const creates: { id: string; data: Record<string, unknown> }[] = [];
  const updates: { id: string; data: Record<string, unknown> }[] = [];
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
      update: jest.fn(
        (args: { where: { id: string }; data: Record<string, unknown> }) => {
          updates.push({ id: args.where.id, data: args.data });
          const row = byId.get(args.where.id)!;
          const next = { ...row, ...args.data } as TaskWithTags;
          byId.set(args.where.id, next);
          return Promise.resolve(next);
        },
      ),
    },
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
    placeNewTask: jest.fn().mockResolvedValue({
      interval: {
        start: new Date("2026-06-08T09:00:00.000Z").getTime(),
        end: new Date("2026-06-08T10:00:00.000Z").getTime(),
      },
      tier: "tier1-earliest",
      rationale: {
        summary: "Placed at the earliest available slot in your work hours.",
      },
    }),
    computeDurationCorrection: makeCorrectionStub(),
    recordEvent: jest.fn().mockResolvedValue(undefined),
  };

  return {
    service: new TasksService(prisma as never, scheduler as never),
    creates,
    updates,
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

  it("creates the task unplaced (scheduledStartTime null) — placement comes from placeNewTask", async () => {
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

  it("places the new task via placeNewTask, then writes the resulting slot back in a second update", async () => {
    const { service, scheduler, updates } = makeCreateService();
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
    expect(scheduler.placeNewTask).toHaveBeenCalledWith(
      user.id,
      expect.anything(),
      now,
      expect.objectContaining({ id: "task-0" }),
      expect.anything(), // tx
    );
    expect(updates[0]).toEqual({
      id: "task-0",
      data: {
        scheduledStartTime: new Date("2026-06-08T09:00:00.000Z"),
        conflict: false,
      },
    });
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

  it("comes back unplaced (conflict: true) with no overflow field when placeNewTask can't place it", async () => {
    const { service, scheduler } = makeCreateService();
    scheduler.placeNewTask.mockResolvedValueOnce({
      interval: null,
      tier: "unplaced",
      rationale: {
        summary:
          "Your calendar is fully booked — we couldn't find room for this yet.",
      },
    });
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

  it("never displaces anything — displaced is always empty (the narrow single-task placer only ever picks a free slot)", async () => {
    const { service } = makeCreateService();
    const result = await service.create(
      {
        title: "Standup",
        durationMinutes: 30,
        deadline: "2026-06-10T17:00:00.000Z",
      },
      user,
    );
    expect(result.displaced).toEqual([]);
  });

  it("surfaces the placement rationale on schedulingMeta.rationale", async () => {
    const { service, scheduler } = makeCreateService();
    scheduler.placeNewTask.mockResolvedValueOnce({
      interval: {
        start: new Date("2026-06-08T20:00:00.000Z").getTime(),
        end: new Date("2026-06-08T21:00:00.000Z").getTime(),
      },
      tier: "tier2",
      rationale: {
        summary:
          "Your work hours were full, so this landed outside them to still meet the deadline.",
      },
    });
    const result = await service.create(
      {
        title: "Standup",
        durationMinutes: 30,
        deadline: "2026-06-10T17:00:00.000Z",
      },
      user,
    );
    expect(result.schedulingMeta.rationale).toContain("work hours were full");
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

describe("TasksService.list — DB-level filter (display window OR unplaced)", () => {
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

    it("the DB query itself excludes a far-out-of-display task (not just JS post-filtering)", async () => {
      // Regression: list() used to fetch EVERY task for the user with no
      // date bound at all and filter in application code; now the query's
      // OR clause does the narrowing, so a fake `findMany` that actually
      // APPLIES `where` (as ours does) must never even hand back "far-next".
      const service = makeService([focalTask, farNextMonth]);
      const res = await service.list(dto, user);
      expect(res.tasks.map((t) => t.id)).toEqual(["focal"]);
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

    it("still surfaces unplaced conflicts regardless of window", async () => {
      const unplaced = task({ id: "unplaced", conflict: true });
      const service = makeService([unplaced, farNextMonth]);
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
 * orchestration (what it saves immediately, whether it flags conflict).
 */
function makeUpdateService(rows: TaskWithTags[]): {
  service: TasksService;
  table: Map<string, TaskWithTags>;
  scheduler: {
    prefsOf: jest.Mock;
    computeDurationCorrection: jest.Mock;
  };
} {
  const table = new Map<string, TaskWithTags>(rows.map((r) => [r.id, r]));

  const tx = {
    task: {
      findFirst: jest.fn((args: { where: { id: string } }) =>
        Promise.resolve(table.get(args.where.id) ?? null),
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
    computeDurationCorrection: makeCorrectionStub(),
  };

  return {
    service: new TasksService(prisma as never, scheduler as never),
    table,
    scheduler,
  };
}

describe("TasksService.update — metadata-only, never auto-searches", () => {
  it("saves a deadline change immediately without touching the task's own placement", async () => {
    const existing = task({
      id: "t1",
      deadline: new Date("2026-06-10T17:00:00Z"),
      scheduledStartTime: new Date("2026-06-08T09:00:00Z"),
    });
    const { service, table } = makeUpdateService([existing]);

    const res = await service.update(
      "t1",
      { deadline: "2026-06-09T17:00:00.000Z" },
      user,
      new Date("2026-06-08T08:00:00Z"),
    );

    expect(table.get("t1")!.deadline?.toISOString()).toBe(
      "2026-06-09T17:00:00.000Z",
    );
    expect(res.task.scheduledStartTime).toBe("2026-06-08T09:00:00.000Z");
    expect(res.deadlineChanged).toBe(true);
    expect(res.displaced).toEqual([]);
    expect(res.batchId).toBeUndefined();
  });

  it("does NOT flag conflict (this is an overdue-own-slot case, not a double-booking) but still surfaces a rationale when the tightened deadline no longer fits the unchanged slot", async () => {
    const existing = task({
      id: "t1",
      durationMinutes: 60,
      scheduledStartTime: new Date("2026-06-08T14:00:00Z"), // ends 15:00
    });
    const { service, table } = makeUpdateService([existing]);

    const res = await service.update(
      "t1",
      { deadline: "2026-06-08T14:30:00.000Z" }, // before the slot's own end
      user,
      new Date("2026-06-08T08:00:00Z"),
    );

    // No OTHER task is anywhere near this one — this is purely "this task's
    // own slot no longer fits its own new deadline," which the frontend
    // already classifies as "overdue" independently. `conflict` is reserved
    // for genuine pairwise overlap (see SchedulerService.markConflicts).
    expect(table.get("t1")!.conflict).toBe(false);
    // The task's OWN slot never moves — update() never auto-searches.
    expect(table.get("t1")!.scheduledStartTime?.toISOString()).toBe(
      "2026-06-08T14:00:00.000Z",
    );
    expect(res.rationale).toBeDefined();
    expect(res.rationale!.summary).toContain("reschedule");
    expect(res.displaced).toEqual([]);
  });

  it("does NOT flag conflict when a loosened deadline still fits the unchanged slot", async () => {
    const existing = task({
      id: "t1",
      durationMinutes: 60,
      scheduledStartTime: new Date("2026-06-08T14:00:00Z"),
      deadline: new Date("2026-06-08T14:30:00Z"),
    });
    const { service, table } = makeUpdateService([existing]);

    const res = await service.update(
      "t1",
      { deadline: "2026-06-08T20:00:00.000Z" }, // loosened, well past the slot's end
      user,
      new Date("2026-06-08T08:00:00Z"),
    );

    expect(table.get("t1")!.conflict).toBe(false);
    expect(res.rationale).toBeUndefined();
  });

  it("skips the invalidation check for a task already in the past", async () => {
    const existing = task({
      id: "t1",
      durationMinutes: 60,
      scheduledStartTime: new Date("2026-06-08T09:00:00Z"),
    });
    const { service, table } = makeUpdateService([existing]);

    const res = await service.update(
      "t1",
      { deadline: "2026-06-08T09:15:00.000Z" }, // would otherwise invalidate it
      user,
      new Date("2026-06-08T10:00:00Z"), // "now" is after the task's own start
    );

    expect(table.get("t1")!.conflict).toBe(false);
    expect(res.rationale).toBeUndefined();
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

  it("title-only edit does NOT trigger duration correction even though the client resends the full (unchanged) tags array", async () => {
    const existing = task({
      id: "t1",
      tags: [tag("backend"), tag("urgent")],
    });
    const { service, table, scheduler } = makeUpdateService([existing]);

    const res = await service.update(
      "t1",
      { title: "Renamed", tags: ["backend", "urgent"] }, // same set, different order
      user,
    );

    expect(scheduler.computeDurationCorrection).not.toHaveBeenCalled();
    expect(res.schedulingMeta).toBeUndefined();
    expect(table.get("t1")!.title).toBe("Renamed");
    expect(
      table
        .get("t1")!
        .tags.map((t) => t.name)
        .sort(),
    ).toEqual(["backend", "urgent"]);
  });

  it("an actual tag-set change (add/remove) DOES trigger the duration corrector", async () => {
    const existing = task({ id: "t1", tags: [tag("backend")] });
    const { service, scheduler } = makeUpdateService([existing]);
    scheduler.computeDurationCorrection.mockResolvedValueOnce({
      estimatedDuration: 60,
      adjustedDuration: 90,
      biasApplied: 1.5,
      durationReason: "#frontend ~50% longer",
    });

    const res = await service.update(
      "t1",
      { tags: ["backend", "frontend"] }, // added a tag
      user,
    );

    expect(scheduler.computeDurationCorrection).toHaveBeenCalled();
    expect(res.schedulingMeta).toEqual(
      expect.objectContaining({ adjustedDuration: 90 }),
    );
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
    // "Today" and "Tomorrow" are end-of-day (23:59) on the current and next
    // calendar day, avoiding 15-min grid boundary issues. Remaining chips use
    // work-hours ceilings.
    expect(res.today).toBe("2026-06-08T23:59:00.000Z");
    expect(res.tomorrow).toBe("2026-06-09T23:59:00.000Z");
    // ISO week (Mon-Sun) ceiling → next Monday 00:00.
    expect(res.thisWeek).toBe("2026-06-15T00:00:00.000Z");
    expect(res.nextWeek).toBe("2026-06-22T00:00:00.000Z");
    expect(res.thisMonth).toBe("2026-07-01T00:00:00.000Z");
    expect(res.noRush).toBe("2026-08-01T00:00:00.000Z");
  });
});

/**
 * Integration-style coverage driven with a REAL SchedulerService over an
 * in-memory task table, so the actual wiring (not just the mock call shape)
 * is exercised for the highest-value flows: direct-write conflict
 * acceptance, delete/complete's bounded conflict-clear, resolvePlacement,
 * undo, and Optimize.
 */
function makeIntegrationService(rows: TaskWithTags[]): {
  service: TasksService;
  table: Map<string, TaskWithTags>;
  events: FakeEvent[];
} {
  const table = new Map<string, TaskWithTags>(rows.map((r) => [r.id, r]));
  let nextId = 0;
  const events: FakeEvent[] = [];

  const taskFindMany = jest.fn((args: { where?: Record<string, unknown> }) =>
    Promise.resolve(
      [...table.values()].filter((t) => matchesWhere(t, args.where)),
    ),
  );
  const taskFindFirst = jest.fn((args: { where?: Record<string, unknown> }) =>
    Promise.resolve(
      [...table.values()].find((t) => matchesWhere(t, args.where)) ?? null,
    ),
  );
  const taskFindUnique = taskFindFirst;
  const taskFindUniqueOrThrow = jest.fn((args: { where: { id: string } }) => {
    const row = table.get(args.where.id);
    if (!row) return Promise.reject(new Error("not found"));
    return Promise.resolve(row);
  });
  const taskUpdate = jest.fn(
    (args: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = table.get(args.where.id)!;
      const next = { ...row, ...args.data } as TaskWithTags;
      table.set(args.where.id, next);
      return Promise.resolve(next);
    },
  );
  const taskDelete = jest.fn((args: { where: { id: string } }) => {
    const row = table.get(args.where.id)!;
    table.delete(args.where.id);
    return Promise.resolve(row);
  });
  const taskCreate = jest.fn((args: { data: Record<string, unknown> }) => {
    const id = `new-${nextId++}`;
    const row = task({
      id,
      title: (args.data.title as string) ?? "Task",
      durationMinutes: (args.data.durationMinutes as number) ?? 60,
      deadline: (args.data.deadline as Date | null) ?? null,
      scheduledStartTime: (args.data.scheduledStartTime as Date | null) ?? null,
      conflict: (args.data.conflict as boolean) ?? false,
    });
    table.set(id, row);
    return Promise.resolve(row);
  });

  const taskEventCreate = jest.fn((args: { data: Record<string, unknown> }) => {
    events.push({
      taskId: args.data.taskId as string,
      userId: args.data.userId as string,
      eventType: args.data.eventType as string,
      oldSnapshot: args.data.oldSnapshot,
      newSnapshot: args.data.newSnapshot,
      rewardScore: (args.data.rewardScore as number) ?? 1,
      occurredAt: (args.data.occurredAt as Date) ?? new Date(),
      batchId: (args.data.batchId as string | undefined) ?? null,
    });
    return Promise.resolve(args.data);
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
          rewardScore: (d.rewardScore as number) ?? 1,
          occurredAt: (d.occurredAt as Date) ?? new Date(),
          batchId: (d.batchId as string | undefined) ?? null,
        });
      }
      return Promise.resolve({ count: args.data.length });
    },
  );
  const taskEventFindMany = jest.fn(
    (args: { where?: Record<string, unknown> } = {}) =>
      Promise.resolve(
        events.filter((e) => matchesTaskEventWhere(e, args.where)),
      ),
  );

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

  const tx = {
    task: {
      findFirst: taskFindFirst,
      findUnique: taskFindUnique,
      findMany: taskFindMany,
      findUniqueOrThrow: taskFindUniqueOrThrow,
      update: taskUpdate,
      delete: taskDelete,
      create: taskCreate,
    },
    tag: {
      createMany: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    },
    user: {
      findUniqueOrThrow: jest
        .fn()
        .mockResolvedValue({ preferenceMatrix: user.preferenceMatrix }),
      update: jest.fn().mockResolvedValue({}),
    },
    taskEvent: {
      create: taskEventCreate,
      createMany: taskEventCreateMany,
      findMany: taskEventFindMany,
    },
    $executeRaw: executeRaw,
  };

  const prisma = {
    $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
    ...tx,
  };

  const scheduler = new SchedulerService(prisma as never);
  const service = new TasksService(prisma as never, scheduler);
  return { service, table, events };
}

describe("TasksService.create — real scheduler, never displaces anything", () => {
  it("routes around an existing far-out task instead of displacing it (the old cost-model guarantee flips: create NEVER displaces)", async () => {
    const day = "2030-06-17"; // Monday
    const farDay = "2030-06-27"; // Thursday, +10 days
    const now = new Date(`${day}T08:00:00.000Z`);

    const far = task({
      id: "far",
      durationMinutes: 60,
      scheduledStartTime: new Date(`${farDay}T09:00:00.000Z`),
    });
    const { service, table } = makeIntegrationService([far]);

    const result = await service.create(
      {
        title: "Urgent",
        durationMinutes: 60,
        deadline: new Date(`${farDay}T10:00:00.000Z`).toISOString(),
      },
      user,
      now,
    );

    // "far" is completely untouched — no eviction, ever.
    expect(table.get("far")!.scheduledStartTime?.toISOString()).toBe(
      `${farDay}T09:00:00.000Z`,
    );
    expect(result.displaced).toEqual([]);
    // The new task still finds room, just not on top of "far".
    expect(result.task.scheduledStartTime).not.toBeNull();
    expect(result.task.scheduledStartTime).not.toBe(`${farDay}T09:00:00.000Z`);
  });
});

describe("TasksService.displace / resize — direct write, conflict accepted", () => {
  const day = "2030-06-17"; // Monday
  const now = new Date(`${day}T08:00:00.000Z`);

  it("displace() writes the requested slot unconditionally and pins manuallyMoved", async () => {
    const moved = task({
      id: "a",
      durationMinutes: 60,
      scheduledStartTime: new Date(`${day}T09:00:00.000Z`),
    });
    const { service, table, events } = makeIntegrationService([moved]);

    await service.displace("a", `${day}T14:00:00.000Z`, user, now);

    expect(table.get("a")!.manuallyMoved).toBe(true);
    expect(table.get("a")!.scheduledStartTime?.toISOString()).toBe(
      `${day}T14:00:00.000Z`,
    );
    expect(events.some((e) => e.eventType === "MOVE" && e.taskId === "a")).toBe(
      true,
    );
  });

  it("displace() onto an occupied slot ACCEPTS the conflict — both tasks flagged, neither's neighbor moved", async () => {
    const dragged = task({
      id: "a",
      durationMinutes: 60,
      scheduledStartTime: new Date(`${day}T13:00:00.000Z`),
    });
    const neighbor = task({
      id: "b",
      title: "Draft proposal",
      durationMinutes: 60,
      scheduledStartTime: new Date(`${day}T09:00:00.000Z`),
    });
    const { service, table } = makeIntegrationService([dragged, neighbor]);

    const res = await service.displace("a", `${day}T09:00:00.000Z`, user, now);

    // "a" lands EXACTLY where dropped.
    expect(table.get("a")!.scheduledStartTime?.toISOString()).toBe(
      `${day}T09:00:00.000Z`,
    );
    // BOTH are flagged conflicting...
    expect(table.get("a")!.conflict).toBe(true);
    expect(table.get("b")!.conflict).toBe(true);
    // ...and "b" never moved.
    expect(table.get("b")!.scheduledStartTime?.toISOString()).toBe(
      `${day}T09:00:00.000Z`,
    );
    // Nothing was "displaced" — a drag never moves another task.
    expect(res.displaced).toEqual([]);
    expect(res.rationale?.summary).toContain("overlaps with 'Draft proposal'");
  });

  it("conflict clears when resolved by a follow-up drag", async () => {
    const a = task({
      id: "a",
      durationMinutes: 60,
      scheduledStartTime: new Date(`${day}T09:00:00.000Z`),
    });
    const b = task({
      id: "b",
      durationMinutes: 60,
      scheduledStartTime: new Date(`${day}T09:00:00.000Z`),
    });
    const { service, table } = makeIntegrationService([a, b]);

    // First drag creates the overlap.
    await service.displace("a", `${day}T09:00:00.000Z`, user, now);
    expect(table.get("a")!.conflict).toBe(true);
    expect(table.get("b")!.conflict).toBe(true);

    // A follow-up drag away resolves it.
    await service.displace("a", `${day}T14:00:00.000Z`, user, now);
    expect(table.get("a")!.conflict).toBe(false);
    expect(table.get("b")!.conflict).toBe(false);
  });

  it("resize() writes the new span unconditionally and accepts a resulting conflict without evicting the neighbor", async () => {
    const resized = task({
      id: "a",
      durationMinutes: 60,
      scheduledStartTime: new Date(`${day}T09:00:00.000Z`),
    });
    const neighbor = task({
      id: "b",
      durationMinutes: 60,
      scheduledStartTime: new Date(`${day}T09:45:00.000Z`),
    });
    const { service, table, events } = makeIntegrationService([
      resized,
      neighbor,
    ]);

    await service.resize("a", `${day}T09:00:00.000Z`, 90, user, now);

    expect(table.get("a")!.durationMinutes).toBe(90);
    expect(table.get("a")!.conflict).toBe(true);
    expect(table.get("b")!.conflict).toBe(true);
    // "b" never moved.
    expect(table.get("b")!.scheduledStartTime?.toISOString()).toBe(
      `${day}T09:45:00.000Z`,
    );
    expect(
      events.some((e) => e.eventType === "RESIZE" && e.taskId === "a"),
    ).toBe(true);
  });
});

describe("TasksService.remove", () => {
  it("deletes the row, leaving an unrelated task's placement/conflict untouched", async () => {
    const day = "2030-06-17";
    const removedTask = task({
      id: "removed",
      durationMinutes: 60,
      scheduledStartTime: new Date(`${day}T09:00:00.000Z`),
    });
    const unrelated = task({
      id: "unrelated",
      durationMinutes: 60,
      scheduledStartTime: new Date(`${day}T13:00:00.000Z`),
      conflict: true,
    });
    const { service, table } = makeIntegrationService([removedTask, unrelated]);

    const result = await service.remove("removed", user);

    expect(table.has("removed")).toBe(false);
    expect(table.get("unrelated")!.scheduledStartTime?.toISOString()).toBe(
      `${day}T13:00:00.000Z`,
    );
    expect(table.get("unrelated")!.conflict).toBe(true); // untouched — not caused by "removed"
    expect(result.displaced).toEqual([]);
    expect(result.batchId).toBeUndefined();
  });

  it("frees the slot: a neighbor that was ONLY conflicting with the removed task has its flag cleared", async () => {
    const day = "2030-06-17";
    const removedTask = task({
      id: "removed",
      durationMinutes: 60,
      scheduledStartTime: new Date(`${day}T09:00:00.000Z`),
      conflict: true,
    });
    const neighbor = task({
      id: "neighbor",
      durationMinutes: 60,
      scheduledStartTime: new Date(`${day}T09:00:00.000Z`),
      conflict: true,
    });
    const { service, table } = makeIntegrationService([removedTask, neighbor]);

    await service.remove("removed", user);

    expect(table.get("neighbor")!.conflict).toBe(false);
  });

  it("throws NotFoundException for a nonexistent task", async () => {
    const { service } = makeIntegrationService([]);
    await expect(service.remove("nope", user)).rejects.toThrow();
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

  it("frees the slot: a neighbor that was ONLY conflicting with the completed task has its flag cleared", async () => {
    const day = "2030-06-17";
    const completedTask = task({
      id: "completed",
      durationMinutes: 60,
      scheduledStartTime: new Date(`${day}T09:00:00.000Z`),
      conflict: true,
    });
    const neighbor = task({
      id: "neighbor",
      durationMinutes: 60,
      scheduledStartTime: new Date(`${day}T09:00:00.000Z`),
      conflict: true,
    });
    const { service, table } = makeIntegrationService([
      completedTask,
      neighbor,
    ]);

    await service.complete("completed", user);

    expect(table.get("completed")!.status).toBe("DONE");
    expect(table.get("neighbor")!.conflict).toBe(false);
  });
});

describe("TasksService.resolvePlacement", () => {
  it("is a no-op when the task isn't currently flagged conflicting", async () => {
    const day = "2030-06-17";
    const fine = task({
      id: "a",
      scheduledStartTime: new Date(`${day}T09:00:00.000Z`),
      conflict: false,
    });
    const { service, table } = makeIntegrationService([fine]);

    const res = await service.resolvePlacement("a", user);

    expect(res.rationale).toBeNull();
    expect(res.displaced).toEqual([]);
    expect(table.get("a")!.scheduledStartTime?.toISOString()).toBe(
      `${day}T09:00:00.000Z`,
    );
  });

  it("re-places a conflicting task, clears the flag, and tags a fresh undoable batch", async () => {
    const day = "2030-06-17"; // Monday
    const broken = task({
      id: "a",
      durationMinutes: 60,
      deadline: new Date(`${day}T17:00:00.000Z`),
      scheduledStartTime: new Date(`${day}T09:00:00.000Z`), // now invalid per the edit
      conflict: true,
    });
    const { service, table } = makeIntegrationService([broken]);

    const res = await service.resolvePlacement(
      "a",
      user,
      new Date(`${day}T08:00:00.000Z`),
    );

    expect(table.get("a")!.conflict).toBe(false);
    expect(table.get("a")!.scheduledStartTime).not.toBeNull();
    expect(res.rationale).not.toBeNull();
    expect(res.batchId).toEqual(expect.any(String));
  });
});

describe("TasksService.undoBatch", () => {
  it("reverts a resolvePlacement batch's task back to its prior (conflicting) slot", async () => {
    const day = "2030-06-17";
    const broken = task({
      id: "a",
      durationMinutes: 60,
      // Tightened past the current slot's own end (10:00) — the current
      // 09:00 slot no longer fits, forcing a genuine relocation.
      deadline: new Date(`${day}T09:30:00.000Z`),
      scheduledStartTime: new Date(`${day}T09:00:00.000Z`),
      conflict: true,
    });
    const { service, table } = makeIntegrationService([broken]);

    const resolved = await service.resolvePlacement(
      "a",
      user,
      new Date(`${day}T08:00:00.000Z`),
    );
    expect(resolved.batchId).toEqual(expect.any(String));
    const newStart = table.get("a")!.scheduledStartTime!.toISOString();

    const undone = await service.undoBatch(resolved.batchId!, user);

    expect(table.get("a")!.scheduledStartTime?.toISOString()).toBe(
      `${day}T09:00:00.000Z`,
    );
    expect(table.get("a")!.scheduledStartTime?.toISOString()).not.toBe(
      newStart,
    );
    expect(undone.displaced).toEqual([
      { taskId: "a", newScheduledStartTime: `${day}T09:00:00.000Z` },
    ]);
  });

  it("throws NotFoundException for a batchId that matches no event", async () => {
    const { service } = makeIntegrationService([]);
    await expect(service.undoBatch("nonexistent-batch", user)).rejects.toThrow(
      "Cannot find reschedule batch with id nonexistent-batch",
    );
  });

  it("relays requiresConfirmation without throwing when the scheduler's pre-flight check finds a touched row", async () => {
    const prisma = {
      $transaction: (fn: (t: unknown) => unknown) => fn({}),
    };
    const scheduler = {
      undoBatch: jest.fn().mockResolvedValue({
        found: true,
        displaced: [],
        requiresConfirmation: true,
        touchedTaskIds: ["a"],
      }),
    };
    const service = new TasksService(prisma as never, scheduler as never);

    const result = await service.undoBatch("batch-1", user);

    expect(result.requiresConfirmation).toBe(true);
    expect(result.touchedTaskIds).toEqual(["a"]);
    expect(result.displaced).toEqual([]);
  });
});

describe("TasksService.optimizePreview / optimizeApply", () => {
  const windowStart = new Date("2026-06-08T00:00:00.000Z");
  const windowEnd = new Date("2026-06-08T23:59:59.000Z");
  const now = new Date("2026-06-08T08:00:00.000Z");

  it("preview counts without writing anything", async () => {
    const a = task({
      id: "a",
      durationMinutes: 60,
      scheduledStartTime: new Date("2026-06-08T09:30:00.000Z"),
    });
    const b = task({
      id: "b",
      durationMinutes: 60,
      scheduledStartTime: new Date("2026-06-08T09:00:00.000Z"),
      createdAt: new Date("2026-01-02T00:00:00.000Z"),
    });
    const { service, table } = makeIntegrationService([a, b]);

    const result = await service.optimizePreview(
      {
        windowStart: windowStart.toISOString(),
        windowEnd: windowEnd.toISOString(),
        mode: "full",
      },
      user,
      now,
    );

    expect(result.count).toBeGreaterThan(0);
    // Nothing written.
    expect(table.get("a")!.scheduledStartTime?.toISOString()).toBe(
      "2026-06-08T09:30:00.000Z",
    );
    expect(table.get("b")!.scheduledStartTime?.toISOString()).toBe(
      "2026-06-08T09:00:00.000Z",
    );
  });

  it("apply writes the reflow and returns a batchId", async () => {
    const a = task({
      id: "a",
      durationMinutes: 60,
      scheduledStartTime: new Date("2026-06-08T09:30:00.000Z"),
    });
    const b = task({
      id: "b",
      durationMinutes: 60,
      scheduledStartTime: new Date("2026-06-08T09:00:00.000Z"),
      createdAt: new Date("2026-01-02T00:00:00.000Z"),
    });
    const { service, table } = makeIntegrationService([a, b]);

    const result = await service.optimizeApply(
      {
        windowStart: windowStart.toISOString(),
        windowEnd: windowEnd.toISOString(),
        mode: "full",
      },
      user,
      now,
    );

    expect(result.count).toBeGreaterThan(0);
    expect(result.batchId).toEqual(expect.any(String));
    expect(table.get("a")!.conflict).toBe(false);
    expect(table.get("b")!.conflict).toBe(false);
  });

  it("mode 'retainManual' only touches the non-manual candidate set", async () => {
    const manual = task({
      id: "manual",
      manuallyMoved: true,
      durationMinutes: 60,
      scheduledStartTime: new Date("2026-06-08T09:00:00.000Z"),
    });
    const flexible = task({
      id: "flexible",
      durationMinutes: 60,
      scheduledStartTime: new Date("2026-06-08T09:30:00.000Z"),
      createdAt: new Date("2026-01-02T00:00:00.000Z"),
    });
    const { service, table } = makeIntegrationService([manual, flexible]);

    const result = await service.optimizeApply(
      {
        windowStart: windowStart.toISOString(),
        windowEnd: windowEnd.toISOString(),
        mode: "retainManual",
      },
      user,
      now,
    );

    expect(result.fixedCount).toBe(1);
    // The manual task never moves.
    expect(table.get("manual")!.scheduledStartTime?.toISOString()).toBe(
      "2026-06-08T09:00:00.000Z",
    );
    // The flexible one reflows around it.
    expect(table.get("flexible")!.scheduledStartTime?.toISOString()).not.toBe(
      "2026-06-08T09:30:00.000Z",
    );
  });

  it("rejects a window wider than MAX_SCAN_DAYS server-side, regardless of client UI caps", async () => {
    const { service } = makeIntegrationService([]);
    const tooWide = new Date(
      windowStart.getTime() + (MAX_SCAN_DAYS + 1) * 24 * 60 * 60 * 1000,
    );
    await expect(
      service.optimizePreview(
        {
          windowStart: windowStart.toISOString(),
          windowEnd: tooWide.toISOString(),
          mode: "full",
        },
        user,
      ),
    ).rejects.toThrow();
  });

  it("rejects windowEnd <= windowStart", async () => {
    const { service } = makeIntegrationService([]);
    await expect(
      service.optimizePreview(
        {
          windowStart: windowEnd.toISOString(),
          windowEnd: windowStart.toISOString(),
          mode: "full",
        },
        user,
      ),
    ).rejects.toThrow();
  });
});
