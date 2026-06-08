import { SchedulerService } from "./scheduler.service";
import type { Task, User } from "../../generated/prisma";

/**
 * Focused coverage for the past-task freeze in {@link SchedulerService.pin} and
 * {@link SchedulerService.resize}: a frozen past task must never have its
 * `conflict` recomputed, and a past block must never cause a live task to be
 * flagged as conflicting. A Prisma mock captures every `task.update` so we can
 * assert exactly which rows changed and to what.
 *
 * `now` is injected (12:00 on 2026-06-08) so a 09:00 task is past and the
 * afternoon is live, without touching the wall clock.
 */

const NOON = new Date("2026-06-08T12:00:00Z");

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

function task(overrides: Partial<Task> & { id: string }): Task {
  return {
    title: "Task",
    note: null,
    durationMinutes: 60,
    deadline: null,
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

interface UpdateCall {
  id: string;
  data: { scheduledStartTime?: Date | null; conflict?: boolean };
}

/**
 * Build a SchedulerService backed by an in-memory task table. Returns the
 * service plus the list of captured `task.update` calls.
 */
function makeService(rows: Task[]): {
  service: SchedulerService;
  updates: UpdateCall[];
} {
  const updates: UpdateCall[] = [];
  const byId = new Map(rows.map((r) => [r.id, r]));

  const tx = {
    task: {
      findMany: jest.fn().mockResolvedValue(rows),
      update: jest.fn(
        (args: { where: { id: string }; data: UpdateCall["data"] }) => {
          const { where, data } = args;
          updates.push({ id: where.id, data });
          const merged = { ...byId.get(where.id)!, ...data };
          byId.set(where.id, merged);
          return Promise.resolve(merged);
        },
      ),
    },
    taskEvent: { create: jest.fn().mockResolvedValue({}) },
    user: { update: jest.fn().mockResolvedValue({}) },
  };

  const prisma = {
    $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
  };

  return {
    service: new SchedulerService(prisma as never),
    updates,
  };
}

describe("SchedulerService.pin — frozen past tasks", () => {
  it("never recomputes a past task's conflict", async () => {
    // A past task already flagged conflict:true, and a live task being pinned
    // elsewhere. The past task must not be updated at all.
    const past = task({
      id: "past",
      conflict: true,
      scheduledStartTime: new Date("2026-06-08T09:00:00Z"),
    });
    const live = task({
      id: "live",
      scheduledStartTime: new Date("2026-06-08T13:00:00Z"),
    });
    const { service, updates } = makeService([past, live]);

    await service.pin(user, "live", new Date("2026-06-08T14:00:00Z"), NOON);

    expect(updates.some((u) => u.id === "past")).toBe(false);
  });

  it("does not let a past block flag the pinned live task as a conflict", async () => {
    // Pin the live task directly on top of the past block's time. Because the
    // past block is excluded from overlap, the live task is conflict-free.
    const past = task({
      id: "past",
      scheduledStartTime: new Date("2026-06-08T09:00:00Z"),
    });
    const live = task({
      id: "live",
      scheduledStartTime: new Date("2026-06-08T13:00:00Z"),
    });
    const { service, updates } = makeService([past, live]);

    const { task: updated } = await service.pin(
      user,
      "live",
      new Date("2026-06-08T09:00:00Z"),
      NOON,
    );

    expect(updated.conflict).toBe(false);
    const liveUpdate = updates.find((u) => u.id === "live");
    expect(liveUpdate?.data.conflict).toBe(false);
    expect(updates.some((u) => u.id === "past")).toBe(false);
  });

  it("still flags a live-vs-live overlap as a conflict", async () => {
    // Sanity: the freeze must not suppress real conflicts between live tasks.
    const a = task({
      id: "a",
      scheduledStartTime: new Date("2026-06-08T13:00:00Z"),
    });
    const b = task({
      id: "b",
      scheduledStartTime: new Date("2026-06-08T15:00:00Z"),
    });
    const { service } = makeService([a, b]);

    const { task: updated } = await service.pin(
      user,
      "b",
      new Date("2026-06-08T13:00:00Z"),
      NOON,
    );

    expect(updated.conflict).toBe(true);
  });
});

describe("SchedulerService.resize — frozen past tasks", () => {
  it("never recomputes a past task's conflict on resize", async () => {
    const past = task({
      id: "past",
      conflict: true,
      scheduledStartTime: new Date("2026-06-08T09:00:00Z"),
    });
    const live = task({
      id: "live",
      scheduledStartTime: new Date("2026-06-08T13:00:00Z"),
    });
    const { service, updates } = makeService([past, live]);

    await service.resize(
      user,
      "live",
      new Date("2026-06-08T13:00:00Z"),
      120,
      NOON,
    );

    expect(updates.some((u) => u.id === "past")).toBe(false);
  });

  it("does not let a past block flag a resized live task as a conflict", async () => {
    // Resize the live task so it would overlap the past block's window; the
    // past block is excluded, so no conflict is raised.
    const past = task({
      id: "past",
      scheduledStartTime: new Date("2026-06-08T09:00:00Z"),
    });
    const live = task({
      id: "live",
      scheduledStartTime: new Date("2026-06-08T13:00:00Z"),
    });
    const { service } = makeService([past, live]);

    const { task: updated } = await service.resize(
      user,
      "live",
      new Date("2026-06-08T09:30:00Z"),
      60,
      NOON,
    );

    expect(updated.conflict).toBe(false);
  });
});
