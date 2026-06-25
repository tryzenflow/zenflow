import { BadRequestException } from "@nestjs/common";
import { UsersService } from "./users.service";
import type { UpdatePreferencesDto } from "./dto/update-preferences.dto";
import type { User } from "../../generated/prisma";

// ---------------------------------------------------------------------------
// Helpers for getUserTagBias tests
// ---------------------------------------------------------------------------

type MockEvent = {
  taskId: string;
  eventType: "CREATE" | "COMPLETE" | "KEEP";
  newSnapshot: Record<string, unknown>;
};

function makeTagBiasService(
  tagNames: string[],
  events: MockEvent[],
): UsersService {
  const findManyTag = jest
    .fn()
    .mockResolvedValue(tagNames.map((name) => ({ name })));
  const findManyEvent = jest.fn().mockResolvedValue(events);
  const prisma = {
    user: { update: jest.fn() },
    tag: { findMany: findManyTag },
    taskEvent: { findMany: findManyEvent },
  };
  const scheduler = { rescheduleAll: jest.fn() };
  return new UsersService(prisma as never, scheduler as never);
}

const user = { id: "user-1" } as User;

const basePrefs: UpdatePreferencesDto = {
  workStart: 540,
  workEnd: 1020,
  workDays: [1, 2, 3, 4, 5],
  timezone: "Asia/Ho_Chi_Minh",
};

type UpdateArgs = { where: { id: string }; data: Record<string, unknown> };

function makeService() {
  const update = jest.fn(
    (args: UpdateArgs): { id: string } & Record<string, unknown> => ({
      id: user.id,
      ...args.data,
    }),
  );
  const prisma = { user: { update } };
  const rescheduleAll = jest.fn().mockResolvedValue(undefined);
  const scheduler = { rescheduleAll };
  const service = new UsersService(prisma as never, scheduler as never);
  return { service, update, rescheduleAll };
}

describe("UsersService.updatePreferences", () => {
  it("persists the schedule and re-schedules all tasks", async () => {
    const { service, update, rescheduleAll } = makeService();

    const result = await service.updatePreferences(user, { ...basePrefs });

    expect(update).toHaveBeenCalledWith({
      where: { id: user.id },
      data: {
        workStart: 540,
        workEnd: 1020,
        workDays: [1, 2, 3, 4, 5],
        timezone: "Asia/Ho_Chi_Minh",
      },
    });
    expect(rescheduleAll).toHaveBeenCalledWith(result);
  });

  it("leaves roleArchetypeId untouched when the key is omitted", async () => {
    const { service, update } = makeService();

    await service.updatePreferences(user, { ...basePrefs });

    const { data } = update.mock.calls[0][0];
    expect("roleArchetypeId" in data).toBe(false);
  });

  it("updates roleArchetypeId when a value is provided", async () => {
    const { service, update } = makeService();

    await service.updatePreferences(user, {
      ...basePrefs,
      roleArchetypeId: "night-owl-dev",
    });

    const { data } = update.mock.calls[0][0];
    expect(data.roleArchetypeId).toBe("night-owl-dev");
  });

  it("clears roleArchetypeId when null is provided", async () => {
    const { service, update } = makeService();

    await service.updatePreferences(user, {
      ...basePrefs,
      roleArchetypeId: null,
    });

    const { data } = update.mock.calls[0][0];
    expect("roleArchetypeId" in data).toBe(true);
    expect(data.roleArchetypeId).toBeNull();
  });

  it("rejects an empty window where workStart equals workEnd", async () => {
    const { service, update } = makeService();

    await expect(
      service.updatePreferences(user, {
        ...basePrefs,
        workStart: 540,
        workEnd: 540,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects a window shorter than one hour", async () => {
    const { service, update } = makeService();

    await expect(
      service.updatePreferences(user, {
        ...basePrefs,
        workStart: 540,
        workEnd: 570,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(update).not.toHaveBeenCalled();
  });

  it("accepts a valid overnight (cross-midnight) window", async () => {
    const { service, update, rescheduleAll } = makeService();

    // 22:00 → 04:00 = 360 effective minutes (a night-owl shift).
    await service.updatePreferences(user, {
      ...basePrefs,
      workStart: 1320,
      workEnd: 240,
    });

    expect(update).toHaveBeenCalled();
    expect(rescheduleAll).toHaveBeenCalled();
  });

  it("rejects a wrap window shorter than one hour", async () => {
    const { service, update } = makeService();

    // 23:45 → 00:15 = 30 effective minutes (wraps, but under MIN_WORKDAY).
    await expect(
      service.updatePreferences(user, {
        ...basePrefs,
        workStart: 1425,
        workEnd: 15,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(update).not.toHaveBeenCalled();
  });
});

describe("UsersService.getUserTagBias", () => {
  it("returns empty tags array when the user has no tags", async () => {
    const service = makeTagBiasService([], []);
    const result = await service.getUserTagBias(user);
    expect(result).toEqual({ tags: [] });
  });

  it("returns empty tags array when tags exist but no events", async () => {
    const service = makeTagBiasService(["backend", "design"], []);
    const result = await service.getUserTagBias(user);
    expect(result).toEqual({ tags: [] });
  });

  it("returns empty tags array when there are only CREATE events (no outcomes)", async () => {
    const service = makeTagBiasService(
      ["backend"],
      [
        {
          taskId: "t1",
          eventType: "CREATE",
          newSnapshot: { durationMinutes: 60, tags: ["backend"] },
        },
      ],
    );
    const result = await service.getUserTagBias(user);
    expect(result).toEqual({ tags: [] });
  });

  it("computes the correct multiplier for a single tag with one COMPLETE event", async () => {
    // estimated = 60 min, actual (COMPLETE) = 90 min → ratio = 1.5
    const service = makeTagBiasService(
      ["backend"],
      [
        {
          taskId: "t1",
          eventType: "COMPLETE",
          newSnapshot: { durationMinutes: 90, tags: ["backend"] },
        },
        {
          taskId: "t1",
          eventType: "CREATE",
          newSnapshot: { durationMinutes: 60, tags: ["backend"] },
        },
      ],
    );
    const result = await service.getUserTagBias(user);
    expect(result.tags).toHaveLength(1);
    expect(result.tags[0]).toEqual({ tag: "backend", n: 1, b: 1.5 });
  });

  it("computes the correct multiplier using a KEEP event", async () => {
    // estimated = 60 min, kept at 30 min → ratio = 0.5
    const service = makeTagBiasService(
      ["design"],
      [
        {
          taskId: "t2",
          eventType: "KEEP",
          newSnapshot: { durationMinutes: 30, tags: ["design"] },
        },
        {
          taskId: "t2",
          eventType: "CREATE",
          newSnapshot: { durationMinutes: 60, tags: ["design"] },
        },
      ],
    );
    const result = await service.getUserTagBias(user);
    expect(result.tags).toHaveLength(1);
    expect(result.tags[0]).toEqual({ tag: "design", n: 1, b: 0.5 });
  });

  it("averages multiple outcome events for the same tag", async () => {
    // Two tasks: t1 ratio=2.0, t2 ratio=1.0 → mean b = 1.5, n = 2
    const service = makeTagBiasService(
      ["backend"],
      [
        {
          taskId: "t1",
          eventType: "COMPLETE",
          newSnapshot: { durationMinutes: 120, tags: ["backend"] },
        },
        {
          taskId: "t1",
          eventType: "CREATE",
          newSnapshot: { durationMinutes: 60, tags: ["backend"] },
        },
        {
          taskId: "t2",
          eventType: "COMPLETE",
          newSnapshot: { durationMinutes: 60, tags: ["backend"] },
        },
        {
          taskId: "t2",
          eventType: "CREATE",
          newSnapshot: { durationMinutes: 60, tags: ["backend"] },
        },
      ],
    );
    const result = await service.getUserTagBias(user);
    expect(result.tags).toHaveLength(1);
    expect(result.tags[0].n).toBe(2);
    expect(result.tags[0].b).toBeCloseTo(1.5);
  });

  it("sorts tags by sample count descending (most-used first)", async () => {
    // "backend": 2 samples, "design": 1 sample → backend should come first
    const service = makeTagBiasService(
      ["backend", "design"],
      [
        {
          taskId: "t1",
          eventType: "COMPLETE",
          newSnapshot: { durationMinutes: 90, tags: ["backend"] },
        },
        {
          taskId: "t1",
          eventType: "CREATE",
          newSnapshot: { durationMinutes: 60, tags: ["backend"] },
        },
        {
          taskId: "t2",
          eventType: "COMPLETE",
          newSnapshot: { durationMinutes: 75, tags: ["backend"] },
        },
        {
          taskId: "t2",
          eventType: "CREATE",
          newSnapshot: { durationMinutes: 60, tags: ["backend"] },
        },
        {
          taskId: "t3",
          eventType: "COMPLETE",
          newSnapshot: { durationMinutes: 30, tags: ["design"] },
        },
        {
          taskId: "t3",
          eventType: "CREATE",
          newSnapshot: { durationMinutes: 60, tags: ["design"] },
        },
      ],
    );
    const result = await service.getUserTagBias(user);
    expect(result.tags).toHaveLength(2);
    expect(result.tags[0].tag).toBe("backend");
    expect(result.tags[0].n).toBe(2);
    expect(result.tags[1].tag).toBe("design");
    expect(result.tags[1].n).toBe(1);
  });

  it("ignores events for tags the user does not own", async () => {
    // User only has "backend"; event snapshot carries "other-tag" which should be ignored.
    const service = makeTagBiasService(
      ["backend"],
      [
        {
          taskId: "t1",
          eventType: "COMPLETE",
          newSnapshot: { durationMinutes: 90, tags: ["other-tag"] },
        },
        {
          taskId: "t1",
          eventType: "CREATE",
          newSnapshot: { durationMinutes: 60, tags: ["other-tag"] },
        },
      ],
    );
    const result = await service.getUserTagBias(user);
    expect(result).toEqual({ tags: [] });
  });

  it("skips outcome events that have no matching CREATE estimate", async () => {
    // Only a COMPLETE event, no CREATE → no estimate to pair with.
    const service = makeTagBiasService(
      ["backend"],
      [
        {
          taskId: "t-orphan",
          eventType: "COMPLETE",
          newSnapshot: { durationMinutes: 90, tags: ["backend"] },
        },
      ],
    );
    const result = await service.getUserTagBias(user);
    expect(result).toEqual({ tags: [] });
  });
});
