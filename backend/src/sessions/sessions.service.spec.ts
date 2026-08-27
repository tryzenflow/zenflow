import { NotFoundException } from "@nestjs/common";
import { SessionsService } from "./sessions.service";
import type { Tag, Session, User } from "../../generated/prisma";
import type { CreateSessionDto } from "./dto/create-session.dto";
import type { UpdateSessionDto } from "./dto/update-session.dto";
import type { DayRescheduleResult } from "@zenflow/shared";

/**
 * Focused coverage for the minimal-CRUD `SessionsService`: each method is a
 * straight Prisma call + thin DTO mapping, so these tests mostly assert the
 * mapping and the plain-diff behaviour of `update` — no placement/EDF
 * concerns exist here anymore beyond confirming `DayRescheduleService` is
 * (or isn't) invoked on deadline changes.
 */

type SessionWithTags = Session & { tags: Tag[] };

/** The shape `SessionsService.create` calls `tx.session.create(...)` with. */
interface SessionCreateCall {
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

function session(
  overrides: Partial<SessionWithTags> & { id: string },
): SessionWithTags {
  return {
    title: "Session",
    note: null,
    durationMinutes: 60,
    // `Session.deadline` is NOT NULL — every fixture needs a real Date.
    deadline: new Date("2026-01-05T12:00:00.000Z"),
    tags: [],
    startTime: 0,
    status: "PENDING",
    type: "MANUAL",
    source: "USER",
    conflict: false,
    scheduledStartTime: null,
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

const DAY_RESCHEDULE_RESULT: DayRescheduleResult = {
  date: "2026-06-10",
  diffs: [],
};

/** A fake DayRescheduleService.rescheduleDay — no real placement, just a spy. */
function fakeDayRescheduleService() {
  return {
    rescheduleDay: jest.fn(
      (): Promise<DayRescheduleResult> =>
        Promise.resolve(DAY_RESCHEDULE_RESULT),
    ),
  };
}

describe("SessionsService.create", () => {
  it("inserts a session, maps tags/dates to the wire shape, and repacks the deadline's day", async () => {
    const created = session({
      id: "session-1",
      title: "Write report",
      durationMinutes: 30,
      deadline: new Date("2026-06-10T17:00:00.000Z"),
      tags: [tagRow("work")],
    });
    const sessionCreate = jest.fn(
      (args: SessionCreateCall): Promise<SessionWithTags> => {
        void args; // captured via .mock.calls below, not used directly here
        return Promise.resolve(created);
      },
    );
    const prisma = {
      $transaction: (fn: (tx: unknown) => unknown) =>
        fn({ session: { create: sessionCreate } }),
    };
    const tagsService = fakeTagsService();
    const dayRescheduleService = fakeDayRescheduleService();
    const service = new SessionsService(
      prisma as never,
      tagsService as never,
      dayRescheduleService as never,
    );

    const dto: CreateSessionDto = {
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
    expect(sessionCreate).toHaveBeenCalledTimes(1);
    const [createArgs] = sessionCreate.mock.calls[0];
    expect(createArgs.data.title).toBe("Write report");
    expect(createArgs.data.durationMinutes).toBe(30);
    expect(createArgs.data.userId).toBe(user.id);
    expect(createArgs.data.deadline).toEqual(
      new Date("2026-06-10T17:00:00.000Z"),
    );
    expect(createArgs.data.tags).toEqual({ connect: [{ id: "tag-work" }] });
    expect(createArgs.include).toEqual({ tags: true });

    // The deadline's local day (UTC tz here) was repacked.
    expect(dayRescheduleService.rescheduleDay).toHaveBeenCalledWith(
      user.id,
      "2026-06-10",
      user.timezone,
      user.preferenceMatrix,
      expect.any(Date),
    );

    expect(result).toEqual({
      id: "session-1",
      title: "Write report",
      note: null,
      durationMinutes: 30,
      deadline: "2026-06-10T17:00:00.000Z",
      tags: ["work"],
      status: "PENDING",
      scheduledStartTime: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      dayReschedule: DAY_RESCHEDULE_RESULT,
    });
  });
});

describe("SessionsService.list", () => {
  it("scopes the query to the user", async () => {
    const rows = [session({ id: "session-1" })];
    const findMany = jest.fn().mockResolvedValue(rows);
    const prisma = { session: { findMany } };
    const service = new SessionsService(
      prisma as never,
      fakeTagsService() as never,
      fakeDayRescheduleService() as never,
    );

    const result = await service.list(
      { view: "day", date: "2026-06-10" },
      user,
    );

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].id).toBe("session-1");
    const [{ where }] = findMany.mock.calls[0] as [
      { where: { userId: string } },
    ];
    expect(where.userId).toBe(user.id);
  });
});

describe("SessionsService.findById", () => {
  it("returns the mapped session when found", async () => {
    const row = session({ id: "session-1" });
    const findUnique = jest.fn().mockResolvedValue(row);
    const prisma = { session: { findUnique } };
    const service = new SessionsService(
      prisma as never,
      fakeTagsService() as never,
      fakeDayRescheduleService() as never,
    );

    const result = await service.findById("session-1", user);
    expect(result.id).toBe("session-1");
  });

  it("throws NotFoundException when missing", async () => {
    const findUnique = jest.fn().mockResolvedValue(null);
    const prisma = { session: { findUnique } };
    const service = new SessionsService(
      prisma as never,
      fakeTagsService() as never,
      fakeDayRescheduleService() as never,
    );

    await expect(service.findById("missing", user)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe("SessionsService.update", () => {
  it("applies only the provided fields as a plain diff and skips the reschedule", async () => {
    const existing = session({ id: "session-1", title: "Old title" });
    const updated = session({
      id: "session-1",
      title: "New title",
      status: "DONE",
    });
    const findFirst = jest.fn().mockResolvedValue(existing);
    const update = jest.fn().mockResolvedValue(updated);
    const prisma = {
      $transaction: (fn: (tx: unknown) => unknown) =>
        fn({ session: { findFirst, update } }),
    };
    const tagsService = fakeTagsService();
    const dayRescheduleService = fakeDayRescheduleService();
    const service = new SessionsService(
      prisma as never,
      tagsService as never,
      dayRescheduleService as never,
    );

    const dto: UpdateSessionDto = { title: "New title", status: "DONE" };
    const result = await service.update("session-1", dto, user);

    expect(update).toHaveBeenCalledWith({
      where: { id: "session-1" },
      data: { title: "New title", status: "DONE" },
      include: { tags: true },
    });
    expect(tagsService.resolveTagIds).not.toHaveBeenCalled();
    expect(dayRescheduleService.rescheduleDay).not.toHaveBeenCalled();
    expect(result.title).toBe("New title");
    expect(result.status).toBe("DONE");
    expect(result.dayReschedule).toBeUndefined();
  });

  it("moves scheduledStartTime directly — a drag/resize is just a field write, no reschedule", async () => {
    const existing = session({ id: "session-1" });
    const moved = session({
      id: "session-1",
      scheduledStartTime: new Date("2026-06-11T09:00:00.000Z"),
    });
    const findFirst = jest.fn().mockResolvedValue(existing);
    const update = jest.fn().mockResolvedValue(moved);
    const prisma = {
      $transaction: (fn: (tx: unknown) => unknown) =>
        fn({ session: { findFirst, update } }),
    };
    const dayRescheduleService = fakeDayRescheduleService();
    const service = new SessionsService(
      prisma as never,
      fakeTagsService() as never,
      dayRescheduleService as never,
    );

    const result = await service.update(
      "session-1",
      { scheduledStartTime: "2026-06-11T09:00:00.000Z" },
      user,
    );

    expect(update).toHaveBeenCalledWith({
      where: { id: "session-1" },
      data: { scheduledStartTime: new Date("2026-06-11T09:00:00.000Z") },
      include: { tags: true },
    });
    expect(dayRescheduleService.rescheduleDay).not.toHaveBeenCalled();
    expect(result.scheduledStartTime).toBe("2026-06-11T09:00:00.000Z");
  });

  it("repacks the NEW deadline's day when the deadline actually changes", async () => {
    const existing = session({
      id: "session-1",
      deadline: new Date("2026-06-10T12:00:00.000Z"),
    });
    const updated = session({
      id: "session-1",
      deadline: new Date("2026-06-12T15:30:00.000Z"),
    });
    const findFirst = jest.fn().mockResolvedValue(existing);
    const update = jest.fn().mockResolvedValue(updated);
    const prisma = {
      $transaction: (fn: (tx: unknown) => unknown) =>
        fn({ session: { findFirst, update } }),
    };
    const dayRescheduleService = fakeDayRescheduleService();
    const service = new SessionsService(
      prisma as never,
      fakeTagsService() as never,
      dayRescheduleService as never,
    );

    const result = await service.update(
      "session-1",
      { deadline: "2026-06-12T15:30:00.000Z" },
      user,
    );

    expect(dayRescheduleService.rescheduleDay).toHaveBeenCalledWith(
      user.id,
      "2026-06-12",
      user.timezone,
      user.preferenceMatrix,
      expect.any(Date),
    );
    expect(result.dayReschedule).toEqual(DAY_RESCHEDULE_RESULT);
  });

  it("does NOT repack when the deadline is resubmitted unchanged", async () => {
    const sameDeadline = new Date("2026-06-10T12:00:00.000Z");
    const existing = session({ id: "session-1", deadline: sameDeadline });
    const updated = session({ id: "session-1", deadline: sameDeadline });
    const findFirst = jest.fn().mockResolvedValue(existing);
    const update = jest.fn().mockResolvedValue(updated);
    const prisma = {
      $transaction: (fn: (tx: unknown) => unknown) =>
        fn({ session: { findFirst, update } }),
    };
    const dayRescheduleService = fakeDayRescheduleService();
    const service = new SessionsService(
      prisma as never,
      fakeTagsService() as never,
      dayRescheduleService as never,
    );

    const result = await service.update(
      "session-1",
      { deadline: sameDeadline.toISOString() },
      user,
    );

    expect(dayRescheduleService.rescheduleDay).not.toHaveBeenCalled();
    expect(result.dayReschedule).toBeUndefined();
  });

  it("throws NotFoundException when the session doesn't belong to the user", async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const prisma = {
      $transaction: (fn: (tx: unknown) => unknown) =>
        fn({ session: { findFirst, update: jest.fn() } }),
    };
    const service = new SessionsService(
      prisma as never,
      fakeTagsService() as never,
      fakeDayRescheduleService() as never,
    );

    await expect(
      service.update("missing", { title: "X" }, user),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("SessionsService.remove", () => {
  it("deletes the session and returns just its id", async () => {
    const existing = session({ id: "session-1" });
    const findFirst = jest.fn().mockResolvedValue(existing);
    const del = jest.fn().mockResolvedValue(existing);
    const prisma = {
      $transaction: (fn: (tx: unknown) => unknown) =>
        fn({ session: { findFirst, delete: del } }),
    };
    const service = new SessionsService(
      prisma as never,
      fakeTagsService() as never,
      fakeDayRescheduleService() as never,
    );

    const result = await service.remove("session-1", user);

    expect(del).toHaveBeenCalledWith({
      where: { id: "session-1", userId: user.id },
    });
    expect(result).toEqual({ id: "session-1" });
  });

  it("throws NotFoundException when the session doesn't exist", async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const prisma = {
      $transaction: (fn: (tx: unknown) => unknown) =>
        fn({ session: { findFirst, delete: jest.fn() } }),
    };
    const service = new SessionsService(
      prisma as never,
      fakeTagsService() as never,
      fakeDayRescheduleService() as never,
    );

    await expect(service.remove("missing", user)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
