import { NotFoundException } from "@nestjs/common";
import { TasksService } from "./tasks.service";
import type { Tag, Task, User } from "../../generated/prisma";
import type { CreateTaskDto } from "./dto/create-task.dto";
import type { UpdateTaskDto } from "./dto/update-task.dto";

/**
 * Focused coverage for the minimal-CRUD `TasksService`: each method is a
 * straight Prisma call + thin DTO mapping, so these tests mostly assert the
 * mapping and the plain-diff behaviour of `update` — no placement/EDF
 * concerns exist here anymore.
 */

type TaskWithTags = Task & { tags: Tag[] };

/** The shape `TasksService.create` calls `tx.task.create(...)` with. */
interface TaskCreateCall {
  data: Record<string, unknown>;
  include: Record<string, unknown>;
}

const user: User = {
  id: "user-1",
  name: "Tester",
  email: "tester@example.com",
  timezone: "UTC",
  lang: "EN_US",
  preferenceMatrix: [],
  preferenceMatrixDecayedAt: null,
  onboardingComplete: true,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
} as unknown as User;

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
    type: "MANUAL",
    source: "USER",
    conflict: false,
    scheduledStartTime: null,
    anchorStartTime: null,
    anchorEndTime: null,
    userId: user.id,
    seriesId: null,
    sessionIndex: null,
    sessionTotal: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function tagRow(name: string): Tag {
  return {
    id: `tag-${name}`,
    name,
    userId: user.id,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

/** A fake TagsService.resolveTagIds — treats each cleaned name as its own id. */
function fakeTagsService() {
  return {
    resolveTagIds: jest.fn(
      (_tx: unknown, _userId: string, names: string[]): Promise<string[]> =>
        Promise.resolve(names.map((n) => `tag-${n}`)),
    ),
  };
}

describe("TasksService.create", () => {
  it("inserts a task and maps tags/dates to the wire shape", async () => {
    const created = task({
      id: "task-1",
      title: "Write report",
      durationMinutes: 30,
      deadline: new Date("2026-06-10T17:00:00.000Z"),
      tags: [tagRow("work")],
    });
    const taskCreate = jest.fn(
      (args: TaskCreateCall): Promise<TaskWithTags> => {
        void args; // captured via .mock.calls below, not used directly here
        return Promise.resolve(created);
      },
    );
    const prisma = {
      $transaction: (fn: (tx: unknown) => unknown) =>
        fn({ task: { create: taskCreate } }),
    };
    const tagsService = fakeTagsService();
    const service = new TasksService(prisma as never, tagsService as never);

    const dto: CreateTaskDto = {
      title: "Write report",
      durationMinutes: 30,
      deadline: "2026-06-10T17:00:00.000Z",
      tags: ["work"],
    };
    const result = await service.create(dto, user);

    expect(tagsService.resolveTagIds).toHaveBeenCalledWith(
      expect.anything(),
      user.id,
      ["work"],
    );
    expect(taskCreate).toHaveBeenCalledTimes(1);
    const [createArgs] = taskCreate.mock.calls[0];
    expect(createArgs.data.title).toBe("Write report");
    expect(createArgs.data.durationMinutes).toBe(30);
    expect(createArgs.data.userId).toBe(user.id);
    expect(createArgs.data.tags).toEqual({ connect: [{ id: "tag-work" }] });
    expect(createArgs.include).toEqual({ tags: true });
    expect(result).toEqual({
      id: "task-1",
      title: "Write report",
      note: null,
      durationMinutes: 30,
      deadline: "2026-06-10T17:00:00.000Z",
      tags: ["work"],
      status: "PENDING",
      scheduledStartTime: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
  });
});

describe("TasksService.list", () => {
  it("scopes the query to the user", async () => {
    const rows = [task({ id: "task-1" })];
    const findMany = jest.fn().mockResolvedValue(rows);
    const prisma = { task: { findMany } };
    const service = new TasksService(
      prisma as never,
      fakeTagsService() as never,
    );

    const result = await service.list(
      { view: "day", date: "2026-06-10" },
      user,
    );

    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].id).toBe("task-1");
    const [{ where }] = findMany.mock.calls[0] as [
      { where: { userId: string } },
    ];
    expect(where.userId).toBe(user.id);
  });
});

describe("TasksService.findById", () => {
  it("returns the mapped task when found", async () => {
    const row = task({ id: "task-1" });
    const findUnique = jest.fn().mockResolvedValue(row);
    const prisma = { task: { findUnique } };
    const service = new TasksService(
      prisma as never,
      fakeTagsService() as never,
    );

    const result = await service.findById("task-1", user);
    expect(result.id).toBe("task-1");
  });

  it("throws NotFoundException when missing", async () => {
    const findUnique = jest.fn().mockResolvedValue(null);
    const prisma = { task: { findUnique } };
    const service = new TasksService(
      prisma as never,
      fakeTagsService() as never,
    );

    await expect(service.findById("missing", user)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe("TasksService.update", () => {
  it("applies only the provided fields as a plain diff", async () => {
    const existing = task({ id: "task-1", title: "Old title" });
    const updated = task({
      id: "task-1",
      title: "New title",
      status: "DONE",
    });
    const findFirst = jest.fn().mockResolvedValue(existing);
    const update = jest.fn().mockResolvedValue(updated);
    const prisma = {
      $transaction: (fn: (tx: unknown) => unknown) =>
        fn({ task: { findFirst, update } }),
    };
    const tagsService = fakeTagsService();
    const service = new TasksService(prisma as never, tagsService as never);

    const dto: UpdateTaskDto = { title: "New title", status: "DONE" };
    const result = await service.update("task-1", dto, user);

    expect(update).toHaveBeenCalledWith({
      where: { id: "task-1" },
      data: { title: "New title", status: "DONE" },
      include: { tags: true },
    });
    expect(tagsService.resolveTagIds).not.toHaveBeenCalled();
    expect(result.title).toBe("New title");
    expect(result.status).toBe("DONE");
  });

  it("moves scheduledStartTime directly — a drag/resize is just a field write", async () => {
    const existing = task({ id: "task-1" });
    const moved = task({
      id: "task-1",
      scheduledStartTime: new Date("2026-06-11T09:00:00.000Z"),
    });
    const findFirst = jest.fn().mockResolvedValue(existing);
    const update = jest.fn().mockResolvedValue(moved);
    const prisma = {
      $transaction: (fn: (tx: unknown) => unknown) =>
        fn({ task: { findFirst, update } }),
    };
    const service = new TasksService(
      prisma as never,
      fakeTagsService() as never,
    );

    const result = await service.update(
      "task-1",
      { scheduledStartTime: "2026-06-11T09:00:00.000Z" },
      user,
    );

    expect(update).toHaveBeenCalledWith({
      where: { id: "task-1" },
      data: { scheduledStartTime: new Date("2026-06-11T09:00:00.000Z") },
      include: { tags: true },
    });
    expect(result.scheduledStartTime).toBe("2026-06-11T09:00:00.000Z");
  });

  it("throws NotFoundException when the task doesn't belong to the user", async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const prisma = {
      $transaction: (fn: (tx: unknown) => unknown) =>
        fn({ task: { findFirst, update: jest.fn() } }),
    };
    const service = new TasksService(
      prisma as never,
      fakeTagsService() as never,
    );

    await expect(
      service.update("missing", { title: "X" }, user),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("TasksService.remove", () => {
  it("deletes the task and returns just its id", async () => {
    const existing = task({ id: "task-1" });
    const findFirst = jest.fn().mockResolvedValue(existing);
    const del = jest.fn().mockResolvedValue(existing);
    const prisma = {
      $transaction: (fn: (tx: unknown) => unknown) =>
        fn({ task: { findFirst, delete: del } }),
    };
    const service = new TasksService(
      prisma as never,
      fakeTagsService() as never,
    );

    const result = await service.remove("task-1", user);

    expect(del).toHaveBeenCalledWith({
      where: { id: "task-1", userId: user.id },
    });
    expect(result).toEqual({ id: "task-1" });
  });

  it("throws NotFoundException when the task doesn't exist", async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const prisma = {
      $transaction: (fn: (tx: unknown) => unknown) =>
        fn({ task: { findFirst, delete: jest.fn() } }),
    };
    const service = new TasksService(
      prisma as never,
      fakeTagsService() as never,
    );

    await expect(service.remove("missing", user)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
