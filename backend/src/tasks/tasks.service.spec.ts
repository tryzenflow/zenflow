import { TasksService } from "./tasks.service";
import type { Tag, Task, User } from "../../generated/prisma";
import type { ListTasksDto } from "./dto/list-tasks.dto";

/** list() reads tasks with their related tags included. */
type TaskWithTags = Task & { tags: Tag[] };

/**
 * Focused coverage for the GET /tasks `list()` display-vs-focal split:
 * - month view renders adjacent-month grid-edge tasks (no blank cells), while
 * - `meta` (allocated minutes + conflict count) stays scoped to the focal month,
 * - week view is unchanged (adjacent-week tasks are NOT returned).
 *
 * The scheduler/horizon range math is unit-tested in horizon.spec.ts; here we
 * drive the service with a Prisma mock so the filtering + meta accounting is
 * exercised end-to-end without a DB.
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
  penaltyMatrix: [],
  roleArchetypeId: null,
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
    // The Prisma row now carries related Tag rows; toDto maps these to names.
    tags: [],
    fixed: false,
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
  // Scheduler is unused by list().
  return new TasksService(prisma as never, {} as never);
}

/**
 * Build a TasksService over an in-memory task table for create(). Captures
 * every `task.create` call so the test can assert exactly how many rows a
 * single POST materializes (must be one — recurrence is gone).
 */
function makeCreateService(): {
  service: TasksService;
  creates: { id: string }[];
} {
  const creates: { id: string }[] = [];
  const byId = new Map<string, TaskWithTags>();

  const tx = {
    tag: {
      createMany: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    },
    task: {
      create: jest.fn((args: { data: Record<string, unknown> }) => {
        const id = `task-${creates.length}`;
        creates.push({ id });
        const row = task({
          id,
          title: (args.data.title as string) ?? "Task",
          fixed: (args.data.fixed as boolean) ?? false,
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
  // The scheduler is stubbed: placement is exercised in scheduler specs.
  const scheduler = {
    cascadeReschedule: jest.fn().mockResolvedValue(undefined),
  };

  return {
    service: new TasksService(prisma as never, scheduler as never),
    creates,
  };
}

describe("TasksService.create — single row (no recurrence)", () => {
  it("materializes exactly one Task row per POST for a flexible task", async () => {
    const { service, creates } = makeCreateService();
    await service.create(
      {
        title: "Standup",
        durationMinutes: 30,
        startDate: "2026-06-10",
      },
      user,
    );
    expect(creates).toHaveLength(1);
  });

  it("materializes exactly one Task row per POST for a fixed task", async () => {
    const { service, creates } = makeCreateService();
    await service.create(
      {
        title: "Meeting",
        durationMinutes: 60,
        fixed: true,
        startTime: 600,
        startDate: "2026-06-10",
      },
      user,
    );
    expect(creates).toHaveLength(1);
  });
});

describe("TasksService.list — display vs focal window", () => {
  describe("month view", () => {
    // June 2026: Jun 1 is a Monday → grid = Mon 2026-06-01 .. Sun 2026-07-05.
    // Leading edge therefore includes late-May? No — Jun 1 is Monday, so the
    // grid leads with June itself; the trailing edge spills into early July.
    const dto: ListTasksDto = { view: "month", date: "2026-06-15" };

    const focalTask = task({
      id: "focal",
      durationMinutes: 90,
      scheduledStartTime: new Date("2026-06-15T10:00:00.000Z"),
    });
    // 2026-07-02 is within the trailing grid week (Mon 06-29 .. Sun 07-05).
    const nextMonthEdge = task({
      id: "next-edge",
      durationMinutes: 120,
      scheduledStartTime: new Date("2026-07-02T10:00:00.000Z"),
    });
    // 2026-07-20 is well past the visible grid → never rendered.
    const farNextMonth = task({
      id: "far-next",
      durationMinutes: 45,
      scheduledStartTime: new Date("2026-07-20T10:00:00.000Z"),
    });

    it("renders next-month grid-edge tasks", async () => {
      const service = makeService([focalTask, nextMonthEdge, farNextMonth]);
      const res = await service.list(dto, user);
      const ids = res.tasks.map((t) => t.id).sort();
      expect(ids).toEqual(["focal", "next-edge"]);
    });

    it("excludes adjacent-month tasks from meta.totalAllocatedMinutes", async () => {
      const withEdge = makeService([focalTask, nextMonthEdge]);
      const withoutEdge = makeService([focalTask]);
      const a = await withEdge.list(dto, user);
      const b = await withoutEdge.list(dto, user);
      // Edge task is rendered but contributes 0 to allocated minutes.
      expect(a.meta.totalAllocatedMinutes).toBe(90);
      expect(b.meta.totalAllocatedMinutes).toBe(90);
    });

    it("excludes adjacent-month conflicts from meta.conflictCount", async () => {
      const edgeConflict = task({
        id: "edge-conflict",
        conflict: true,
        scheduledStartTime: new Date("2026-07-02T10:00:00.000Z"),
      });
      const focalConflict = task({
        id: "focal-conflict",
        conflict: true,
        scheduledStartTime: new Date("2026-06-10T10:00:00.000Z"),
      });
      const service = makeService([focalConflict, edgeConflict]);
      const res = await service.list(dto, user);
      const ids = res.tasks.map((t) => t.id).sort();
      // Both rendered (the edge conflict sits in the visible grid)…
      expect(ids).toEqual(["edge-conflict", "focal-conflict"]);
      // …but only the focal-month conflict is counted.
      expect(res.meta.conflictCount).toBe(1);
    });

    it("renders a leading prev-month edge for a Thursday-starting month", async () => {
      // Oct 2026: Oct 1 is a Thursday → grid leads with Mon 2026-09-28.
      const octDto: ListTasksDto = { view: "month", date: "2026-10-15" };
      const prevEdge = task({
        id: "prev-edge",
        durationMinutes: 30,
        scheduledStartTime: new Date("2026-09-29T10:00:00.000Z"),
      });
      const focal = task({
        id: "oct-focal",
        durationMinutes: 60,
        scheduledStartTime: new Date("2026-10-15T10:00:00.000Z"),
      });
      const service = makeService([prevEdge, focal]);
      const res = await service.list(octDto, user);
      expect(res.tasks.map((t) => t.id).sort()).toEqual([
        "oct-focal",
        "prev-edge",
      ]);
      // Prev-month edge rendered but excluded from meta.
      expect(res.meta.totalAllocatedMinutes).toBe(60);
    });

    it("maps related Tag rows to a sorted name array on the DTO", async () => {
      const tagged = task({
        id: "tagged",
        scheduledStartTime: new Date("2026-06-15T10:00:00.000Z"),
        tags: [tag("work"), tag("admin")],
      });
      const service = makeService([tagged]);
      const res = await service.list(dto, user);
      const out = res.tasks.find((t) => t.id === "tagged");
      expect(out?.tags).toEqual(["admin", "work"]);
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
    // Week of 2026-06-10 → Mon 2026-06-08 .. Sun 2026-06-14.
    const dto: ListTasksDto = { view: "week", date: "2026-06-10" };

    it("does NOT return an adjacent-week task", async () => {
      const inWeek = task({
        id: "in-week",
        scheduledStartTime: new Date("2026-06-10T10:00:00.000Z"),
      });
      // 2026-06-16 is the following week → must not appear.
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
