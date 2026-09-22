/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { TagsService } from "../tags/tags.service";
import { TaskPlacementService } from "../scheduler/io/task-placement.service";
import { NO_FEASIBLE_SLOT_MESSAGE, SeriesService } from "./series.service";
import { occurrenceId } from "../scheduler/core/recurrence";
import type { Tag, Session, SessionSeries, User } from "../../generated/prisma";

/**
 * Focused coverage for `SeriesService`'s two drag/resize-confirmation scope
 * methods — `updateSiblingTimeOfDay` (materialized `TASK` series sittings) and
 * `updateRecurringFollowing` (recurring fixed series "this and following").
 * `SessionUpdateService`'s own routing into these is covered by
 * `session-update.service.spec.ts`; these tests exercise the methods directly
 * against a hand-rolled Prisma double (`TaskPlacementService`/`TagsService`
 * aren't touched by either method, so they're stubbed out).
 */

type SessionRow = Session & { tags: Tag[]; series: SessionSeries | null };

const user: User = {
  id: "user-1",
  name: "Tester",
  email: "tester@example.com",
  timezone: "UTC",
  lang: "EN_US",
  preferenceMatrix: [],
  preferenceMatrixDecayedAt: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
} as unknown as User;

function session(overrides: Partial<SessionRow> & { id: string }): SessionRow {
  return {
    title: "Session",
    note: null,
    location: null,
    durationMinutes: 60,
    deadline: null,
    tags: [],
    series: null,
    type: "TASK",
    source: "USER",
    conflict: false,
    scheduledStartTime: null,
    lastMovedAt: null,
    retainedAt: null,
    deleted: false,
    userId: user.id,
    seriesId: null,
    sessionIndex: null,
    sessionTotal: null,
    externalKey: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

async function makeSeriesService(
  prisma: unknown,
  tags: unknown = { resolveTagIds: jest.fn().mockResolvedValue([]) },
  placement: unknown = {
    canPlaceSeries: jest.fn(),
    placeSeriesOnCreate: jest.fn(),
    redistributeSeries: jest.fn(),
  },
): Promise<SeriesService> {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      SeriesService,
      { provide: PrismaService, useValue: prisma },
      { provide: TagsService, useValue: tags },
      { provide: TaskPlacementService, useValue: placement },
    ],
  }).compile();
  return module.get<SeriesService>(SeriesService);
}

describe("SeriesService.updateSiblingTimeOfDay", () => {
  const members = [
    session({
      id: "s-1",
      seriesId: "task-series-1",
      sessionIndex: 1,
      sessionTotal: 3,
      scheduledStartTime: new Date("2026-06-01T08:00:00.000Z"),
    }),
    session({
      id: "s-2",
      seriesId: "task-series-1",
      sessionIndex: 2,
      sessionTotal: 3,
      scheduledStartTime: new Date("2026-06-03T08:00:00.000Z"),
    }),
    session({
      id: "s-3",
      seriesId: "task-series-1",
      sessionIndex: 3,
      sessionTotal: 3,
      scheduledStartTime: new Date("2026-06-05T08:00:00.000Z"),
    }),
  ];

  function buildPrisma(sessionUpdate: jest.Mock) {
    const findMany = jest.fn().mockResolvedValue(members);
    const update = sessionUpdate;
    const prisma = {
      session: { findMany, update },
      $transaction: (fn: (t: unknown) => unknown) => fn(prisma),
    };
    return { prisma, findMany };
  }

  it("scope 'following': re-anchors the anchor + later sittings' time-of-day, keeps each one's own date, leaves earlier sittings untouched", async () => {
    const sessionUpdate = jest.fn((args: { where: { id: string } }) =>
      Promise.resolve(
        members.find((m) => m.id === args.where.id) as SessionRow,
      ),
    );
    const { prisma } = buildPrisma(sessionUpdate);
    const service = await makeSeriesService(prisma);

    const { sessions, skippedSessionIds } =
      await service.updateSiblingTimeOfDay(
        "task-series-1",
        "s-2",
        { timeOfDayMinutes: 10 * 60, durationMinutes: 90 },
        false,
        false,
        user,
      );

    expect(skippedSessionIds).toEqual([]);
    expect(sessionUpdate).toHaveBeenCalledTimes(2);
    expect(sessionUpdate).toHaveBeenCalledWith({
      where: { id: "s-2" },
      data: {
        scheduledStartTime: new Date("2026-06-03T10:00:00.000Z"),
        durationMinutes: 90,
      },
      include: expect.anything(),
    });
    expect(sessionUpdate).toHaveBeenCalledWith({
      where: { id: "s-3" },
      data: {
        scheduledStartTime: new Date("2026-06-05T10:00:00.000Z"),
        durationMinutes: 90,
      },
      include: expect.anything(),
    });
    // s-1 (before the anchor) is untouched.
    expect(sessions.find((s) => s.id === "s-1")?.scheduledStartTime).toBe(
      "2026-06-01T08:00:00.000Z",
    );
  });

  it("scopeAll (all sittings) re-anchors every member including one before the anchor", async () => {
    const sessionUpdate = jest.fn((args: { where: { id: string } }) =>
      Promise.resolve(
        members.find((m) => m.id === args.where.id) as SessionRow,
      ),
    );
    const { prisma } = buildPrisma(sessionUpdate);
    const service = await makeSeriesService(prisma);

    await service.updateSiblingTimeOfDay(
      "task-series-1",
      "s-2",
      { timeOfDayMinutes: 9 * 60 },
      true,
      false,
      user,
    );

    expect(sessionUpdate).toHaveBeenCalledTimes(3);
    expect(sessionUpdate).toHaveBeenCalledWith({
      where: { id: "s-1" },
      // No durationMinutes override — the sitting keeps its own.
      data: {
        scheduledStartTime: new Date("2026-06-01T09:00:00.000Z"),
        durationMinutes: 60,
      },
      include: expect.anything(),
    });
  });

  it("skipConflicting leaves a colliding landing untouched and reports its id", async () => {
    const sessionUpdate = jest.fn((args: { where: { id: string } }) =>
      Promise.resolve(
        members.find((m) => m.id === args.where.id) as SessionRow,
      ),
    );
    // A standalone session already occupies s-3's new landing.
    const collidingLanding = new Date("2026-06-05T10:00:00.000Z");
    const dayLoadFindMany = jest.fn(
      (args: {
        where: { scheduledStartTime?: { gte?: Date; lte?: Date } };
      }) => {
        const gte = args.where.scheduledStartTime?.gte?.getTime() ?? 0;
        const lte = args.where.scheduledStartTime?.lte?.getTime() ?? Infinity;
        const t = collidingLanding.getTime();
        if (t >= gte && t <= lte) {
          return Promise.resolve([
            {
              scheduledStartTime: collidingLanding,
              durationMinutes: 30,
              type: "TASK",
            },
          ]);
        }
        return Promise.resolve([]);
      },
    );

    const findMany = jest.fn((args: { where: { seriesId?: string } }) => {
      if (args.where.seriesId) return Promise.resolve(members);
      return dayLoadFindMany(
        args as {
          where: { scheduledStartTime?: { gte?: Date; lte?: Date } };
        },
      );
    });
    const prisma = {
      session: { findMany, update: sessionUpdate },
      sessionSeries: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: (fn: (t: unknown) => unknown) => fn(prisma),
    };
    const service = await makeSeriesService(prisma);

    const { sessions, skippedSessionIds } =
      await service.updateSiblingTimeOfDay(
        "task-series-1",
        "s-2",
        { timeOfDayMinutes: 10 * 60, durationMinutes: 90 },
        false,
        true,
        user,
      );

    expect(skippedSessionIds).toEqual(["s-3"]);
    // s-2 (no conflict) was still updated...
    expect(sessionUpdate).toHaveBeenCalledWith({
      where: { id: "s-2" },
      data: {
        scheduledStartTime: new Date("2026-06-03T10:00:00.000Z"),
        durationMinutes: 90,
      },
      include: expect.anything(),
    });
    // ...but s-3 was never written and comes back with its prior state.
    expect(sessionUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "s-3" } }),
    );
    expect(sessions.find((s) => s.id === "s-3")?.scheduledStartTime).toBe(
      "2026-06-05T08:00:00.000Z",
    );
  });

  it("throws NotFoundException when the series has no members", async () => {
    const prisma = {
      session: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: (fn: (t: unknown) => unknown) => fn(prisma),
    };
    const service = await makeSeriesService(prisma);

    await expect(
      service.updateSiblingTimeOfDay(
        "missing-series",
        "s-1",
        { timeOfDayMinutes: 600 },
        false,
        false,
        user,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("throws NotFoundException when the anchor isn't a member of the series", async () => {
    const prisma = {
      session: { findMany: jest.fn().mockResolvedValue(members) },
      $transaction: (fn: (t: unknown) => unknown) => fn(prisma),
    };
    const service = await makeSeriesService(prisma);

    await expect(
      service.updateSiblingTimeOfDay(
        "task-series-1",
        "not-a-member",
        { timeOfDayMinutes: 600 },
        false,
        false,
        user,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("SeriesService.updateRecurringFollowing", () => {
  const oldSeriesId = "lecture-series-1";
  const newSeriesId = "lecture-series-2";
  const oldRep = session({
    id: "rep-old-1",
    type: "LECTURE",
    seriesId: oldSeriesId,
    title: "Gym",
    note: "bring a towel",
    tags: [
      { id: "tag-1", name: "fitness", userId: user.id, createdAt: new Date() },
    ],
    scheduledStartTime: new Date("2026-06-01T09:00:00.000Z"),
    durationMinutes: 60,
  });

  function buildPrisma(opts: {
    rrule: string;
    conflicting?: { start: Date; durationMinutes: number };
  }) {
    const seriesFindFirst = jest.fn(
      (args: { where: { id: string }; include?: { sessions?: unknown } }) => {
        if (args.where.id === oldSeriesId) {
          return Promise.resolve({
            id: oldSeriesId,
            rrule: opts.rrule,
            exdates: [],
            userId: user.id,
            sessions: [oldRep],
          });
        }
        if (args.where.id === newSeriesId) {
          return Promise.resolve({
            id: newSeriesId,
            rrule: opts.rrule,
            exdates: [],
            userId: user.id,
          });
        }
        return Promise.resolve(null);
      },
    );
    const seriesUpdate = jest.fn().mockResolvedValue({});
    const seriesCreate = jest
      .fn()
      .mockResolvedValue({ id: newSeriesId, type: "LECTURE" });
    let createdSession: SessionRow | null = null;
    const sessionCreate = jest.fn(
      (args: {
        data: {
          type: string;
          source: string;
          title: string;
          note: string | null;
          durationMinutes: number;
          scheduledStartTime: Date;
          seriesId: string;
          tags: { connect: { id: string }[] };
        };
      }) => {
        createdSession = session({
          id: "rep-new-1",
          type: args.data.type as "LECTURE",
          source: args.data.source as "USER",
          title: args.data.title,
          note: args.data.note,
          durationMinutes: args.data.durationMinutes,
          scheduledStartTime: args.data.scheduledStartTime,
          seriesId: args.data.seriesId,
          tags: oldRep.tags,
        });
        return Promise.resolve(createdSession);
      },
    );
    const eventCreate = jest.fn().mockResolvedValue({});

    const conflictSessionFindMany = jest.fn(
      (args: {
        where: { scheduledStartTime?: { gte?: Date; lte?: Date } };
      }) => {
        if (!opts.conflicting) return Promise.resolve([]);
        const gte = args.where.scheduledStartTime?.gte?.getTime() ?? 0;
        const lte = args.where.scheduledStartTime?.lte?.getTime() ?? Infinity;
        const t = opts.conflicting.start.getTime();
        if (t >= gte && t <= lte) {
          return Promise.resolve([
            {
              scheduledStartTime: opts.conflicting.start,
              durationMinutes: opts.conflicting.durationMinutes,
              type: "TASK",
            },
          ]);
        }
        return Promise.resolve([]);
      },
    );

    const prisma: Record<string, unknown> = {
      sessionSeries: {
        findFirst: seriesFindFirst,
        update: seriesUpdate,
        create: seriesCreate,
        findMany: jest.fn().mockResolvedValue([]),
      },
      session: { create: sessionCreate, findMany: conflictSessionFindMany },
      sessionEvent: { create: eventCreate },
    };
    prisma.$transaction = (fn: (t: unknown) => unknown) => fn(prisma);

    return {
      prisma,
      seriesFindFirst,
      seriesUpdate,
      seriesCreate,
      sessionCreate,
      eventCreate,
      getCreatedSession: () => createdSession,
    };
  }

  it("truncates the old series and creates a new one anchored at the new date/time, carrying title/note/tags/type forward", async () => {
    const { prisma, seriesUpdate, seriesCreate, sessionCreate, eventCreate } =
      buildPrisma({ rrule: "FREQ=DAILY" });
    const service = await makeSeriesService(prisma);

    const result = await service.updateRecurringFollowing(
      oldSeriesId,
      "2026-06-10T09:00:00.000Z",
      { scheduledStartTime: "2026-06-15T14:00:00.000Z", durationMinutes: 90 },
      false,
      user,
    );

    // The old series was truncated (UNTIL pulled back).
    expect(seriesUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: oldSeriesId } }),
    );
    // A brand-new series + representative row was created.
    expect(seriesCreate).toHaveBeenCalledWith({
      data: {
        type: "LECTURE",
        rrule: "FREQ=DAILY",
        deadline: null,
        userId: user.id,
      },
    });
    expect(sessionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "LECTURE",
          title: "Gym",
          note: "bring a towel",
          durationMinutes: 90,
          scheduledStartTime: new Date("2026-06-15T14:00:00.000Z"),
          seriesId: "lecture-series-2",
          tags: { connect: [{ id: "tag-1" }] },
        }),
      }),
    );
    expect(eventCreate).toHaveBeenCalledTimes(1);
    expect(result.session.id).toBe("rep-new-1");
    expect(result.session.scheduledStartTime).toBe("2026-06-15T14:00:00.000Z");
    expect(result.skippedSessionIds).toEqual([]);
  });

  it("skipConflicting prunes a colliding future occurrence into the new series' exdates", async () => {
    const conflicting = {
      start: new Date("2026-06-16T14:15:00.000Z"),
      durationMinutes: 30,
    };
    const { prisma, seriesUpdate } = buildPrisma({
      rrule: "FREQ=DAILY;COUNT=3",
      conflicting,
    });
    const service = await makeSeriesService(prisma);

    const result = await service.updateRecurringFollowing(
      oldSeriesId,
      "2026-06-10T09:00:00.000Z",
      { scheduledStartTime: "2026-06-15T14:00:00.000Z", durationMinutes: 90 },
      true,
      user,
    );

    // The colliding day (2026-06-16, 2nd of the 3 COUNT occurrences) was
    // pushed onto the NEW series' exdates.
    expect(seriesUpdate).toHaveBeenCalledWith({
      where: { id: "lecture-series-2" },
      data: { exdates: { push: "2026-06-16T14:00:00.000Z" } },
    });
    expect(result.skippedSessionIds).toEqual([
      occurrenceId("lecture-series-2", new Date("2026-06-16T14:00:00.000Z")),
    ]);
  });

  it("throws NotFoundException for a series the user does not own / that isn't recurring", async () => {
    const prisma = {
      sessionSeries: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(),
    };
    const service = await makeSeriesService(prisma);

    await expect(
      service.updateRecurringFollowing(
        "nope",
        "2026-06-10T09:00:00.000Z",
        { scheduledStartTime: "2026-06-15T14:00:00.000Z", durationMinutes: 90 },
        false,
        user,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

/**
 * Edit-mode "session count" resize/promote — the create-mode session-count
 * slider's edit-mode counterpart (issue: editable sessionCount). Exercises
 * `resizeSessionCount` (grow/shrink/no-op/not-found) and `promoteToSeries`
 * directly against hand-rolled `PrismaService` / `TaskPlacementService` /
 * `TagsService` doubles, mirroring this file's other describe blocks.
 * `SessionUpdateService`'s routing into these (single-TASK promotion, the
 * sessionCount-vs-deadline branch priority) is covered by
 * `session-update.service.spec.ts`.
 */
describe("SeriesService.resizeSessionCount", () => {
  const seriesId = "task-series-1";
  const deadline = new Date("2026-07-01T00:00:00.000Z");

  function seriesRow(): SessionSeries {
    return {
      id: seriesId,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      type: "TASK",
      deadline,
      rrule: null,
      exdates: [],
      userId: user.id,
    };
  }

  function twoMembers(): SessionRow[] {
    return [
      session({
        id: "s-1",
        seriesId,
        sessionIndex: 1,
        sessionTotal: 2,
        deadline,
        durationMinutes: 60,
        scheduledStartTime: new Date("2026-06-01T08:00:00.000Z"),
      }),
      session({
        id: "s-2",
        seriesId,
        sessionIndex: 2,
        sessionTotal: 2,
        deadline,
        durationMinutes: 60,
        scheduledStartTime: new Date("2026-06-03T08:00:00.000Z"),
      }),
    ];
  }

  function makeTransaction(tx: Record<string, unknown>) {
    return (arg: unknown) =>
      typeof arg === "function"
        ? (arg as (t: unknown) => unknown)(tx)
        : Promise.all(arg as Promise<unknown>[]);
  }

  it("grows the series: new rows continue sessionIndex, sessionTotal is rewritten on every member, a CREATE event fires per new row, and only the new members are placed", async () => {
    const members = twoMembers();
    const seriesFindFirst = jest.fn().mockResolvedValue(seriesRow());
    const memberFindMany = jest.fn().mockResolvedValue(members);
    const sessionUpdateMany = jest.fn().mockResolvedValue({ count: 2 });
    let createdCount = 0;
    const sessionCreate = jest.fn((args: { data: Record<string, unknown> }) => {
      createdCount++;
      return Promise.resolve(
        session({
          id: `s-new-${createdCount}`,
          seriesId,
          deadline,
          durationMinutes: 60,
          sessionIndex: args.data.sessionIndex as number,
          sessionTotal: args.data.sessionTotal as number,
          title: args.data.title as string,
        }),
      );
    });
    const eventCreate = jest.fn().mockResolvedValue({});
    const tx = {
      session: { updateMany: sessionUpdateMany, create: sessionCreate },
      sessionEvent: { create: eventCreate },
    };
    const prisma = {
      sessionSeries: { findFirst: seriesFindFirst },
      session: { findMany: memberFindMany },
      $transaction: makeTransaction(tx),
    };
    const placement = {
      canPlaceSeries: jest.fn().mockResolvedValue(true),
      placeSeriesOnCreate: jest.fn().mockResolvedValue([
        {
          id: "s-new-1",
          scheduledStartTime: new Date("2026-06-05T08:00:00.000Z"),
        },
        {
          id: "s-new-2",
          scheduledStartTime: new Date("2026-06-07T08:00:00.000Z"),
        },
      ]),
    };
    const service = await makeSeriesService(
      prisma,
      { resolveTagIds: jest.fn() },
      placement,
    );

    const now = new Date("2026-05-30T00:00:00.000Z");
    const result = await service.resizeSessionCount(seriesId, 4, user, now);

    expect(placement.canPlaceSeries).toHaveBeenCalledWith({
      user,
      durationMinutes: 60,
      sessionCount: 2,
      deadline,
      now,
    });
    expect(sessionCreate).toHaveBeenCalledTimes(2);
    expect(sessionCreate.mock.calls[0][0].data.sessionIndex).toBe(3);
    expect(sessionCreate.mock.calls[1][0].data.sessionIndex).toBe(4);
    expect(sessionCreate.mock.calls[0][0].data.sessionTotal).toBe(4);
    expect(sessionCreate.mock.calls[0][0].data.title).toBe(members[0].title);
    expect(eventCreate).toHaveBeenCalledTimes(2);
    expect(sessionUpdateMany).toHaveBeenCalledWith({
      where: { seriesId, userId: user.id },
      data: { sessionTotal: 4 },
    });
    expect(placement.placeSeriesOnCreate).toHaveBeenCalledWith({
      user,
      seriesId,
      members: [
        { id: "s-new-1", durationMinutes: 60 },
        { id: "s-new-2", durationMinutes: 60 },
      ],
      deadline,
      now,
    });

    expect(result.map((s) => s.id)).toEqual([
      "s-1",
      "s-2",
      "s-new-1",
      "s-new-2",
    ]);
    expect(result.every((s) => s.sessionTotal === 4)).toBe(true);
    expect(result.find((s) => s.id === "s-new-1")?.scheduledStartTime).toBe(
      "2026-06-05T08:00:00.000Z",
    );
  });

  it("rejects growing with NO_FEASIBLE_SLOT_MESSAGE and writes nothing when the added sittings don't fit", async () => {
    const seriesFindFirst = jest.fn().mockResolvedValue(seriesRow());
    const memberFindMany = jest.fn().mockResolvedValue(twoMembers());
    const transaction = jest.fn();
    const prisma = {
      sessionSeries: { findFirst: seriesFindFirst },
      session: { findMany: memberFindMany },
      $transaction: transaction,
    };
    const placement = {
      canPlaceSeries: jest.fn().mockResolvedValue(false),
      placeSeriesOnCreate: jest.fn(),
    };
    const service = await makeSeriesService(
      prisma,
      { resolveTagIds: jest.fn() },
      placement,
    );

    await expect(
      service.resizeSessionCount(
        seriesId,
        4,
        user,
        new Date("2026-05-30T00:00:00.000Z"),
      ),
    ).rejects.toThrow(NO_FEASIBLE_SLOT_MESSAGE);
    expect(transaction).not.toHaveBeenCalled();
    expect(placement.placeSeriesOnCreate).not.toHaveBeenCalled();
  });

  it("shrinks the series: removes the highest-sessionIndex members and rewrites sessionTotal on the survivors", async () => {
    const now = new Date("2026-05-30T00:00:00.000Z");
    const members = [
      session({
        id: "s-1",
        seriesId,
        sessionIndex: 1,
        sessionTotal: 3,
        deadline,
        scheduledStartTime: new Date("2026-06-01T08:00:00.000Z"),
      }),
      session({
        id: "s-2",
        seriesId,
        sessionIndex: 2,
        sessionTotal: 3,
        deadline,
        scheduledStartTime: new Date("2026-06-05T08:00:00.000Z"),
      }),
      session({
        id: "s-3",
        seriesId,
        sessionIndex: 3,
        sessionTotal: 3,
        deadline,
        scheduledStartTime: null,
      }),
    ];
    const seriesFindFirst = jest.fn().mockResolvedValue(seriesRow());
    const memberFindMany = jest.fn().mockResolvedValue(members);
    const deleteMany = jest.fn().mockResolvedValue({ count: 1 });
    const updateMany = jest.fn().mockResolvedValue({ count: 2 });
    const prisma = {
      sessionSeries: { findFirst: seriesFindFirst },
      session: { findMany: memberFindMany, deleteMany, updateMany },
      $transaction: (arg: unknown) => Promise.all(arg as Promise<unknown>[]),
    };
    const placement = {
      canPlaceSeries: jest.fn(),
      placeSeriesOnCreate: jest.fn(),
    };
    const service = await makeSeriesService(
      prisma,
      { resolveTagIds: jest.fn() },
      placement,
    );

    const result = await service.resizeSessionCount(seriesId, 2, user, now);

    expect(deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["s-3"] }, userId: user.id },
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { seriesId, userId: user.id },
      data: { sessionTotal: 2 },
    });
    expect(result.map((s) => s.id)).toEqual(["s-1", "s-2"]);
    expect(result.every((s) => s.sessionTotal === 2)).toBe(true);
  });

  it("rejects shrinking and writes nothing when a removal candidate has already started", async () => {
    const now = new Date("2026-06-05T09:00:00.000Z");
    const members = [
      session({
        id: "s-1",
        seriesId,
        sessionIndex: 1,
        sessionTotal: 3,
        deadline,
        scheduledStartTime: new Date("2026-06-01T08:00:00.000Z"),
      }),
      // Being removed (highest 2 indices) and already started relative to `now`.
      session({
        id: "s-2",
        seriesId,
        sessionIndex: 2,
        sessionTotal: 3,
        deadline,
        scheduledStartTime: new Date("2026-06-05T08:00:00.000Z"),
      }),
      session({
        id: "s-3",
        seriesId,
        sessionIndex: 3,
        sessionTotal: 3,
        deadline,
        scheduledStartTime: new Date("2026-06-10T08:00:00.000Z"),
      }),
    ];
    const seriesFindFirst = jest.fn().mockResolvedValue(seriesRow());
    const memberFindMany = jest.fn().mockResolvedValue(members);
    const transaction = jest.fn();
    const prisma = {
      sessionSeries: { findFirst: seriesFindFirst },
      session: { findMany: memberFindMany },
      $transaction: transaction,
    };
    const placement = {
      canPlaceSeries: jest.fn(),
      placeSeriesOnCreate: jest.fn(),
    };
    const service = await makeSeriesService(
      prisma,
      { resolveTagIds: jest.fn() },
      placement,
    );

    await expect(
      service.resizeSessionCount(seriesId, 1, user, now),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("is a no-op and writes nothing when targetCount already matches", async () => {
    const members = twoMembers();
    const seriesFindFirst = jest.fn().mockResolvedValue(seriesRow());
    const memberFindMany = jest.fn().mockResolvedValue(members);
    const transaction = jest.fn();
    const prisma = {
      sessionSeries: { findFirst: seriesFindFirst },
      session: { findMany: memberFindMany },
      $transaction: transaction,
    };
    const placement = {
      canPlaceSeries: jest.fn(),
      placeSeriesOnCreate: jest.fn(),
    };
    const service = await makeSeriesService(
      prisma,
      { resolveTagIds: jest.fn() },
      placement,
    );

    const result = await service.resizeSessionCount(
      seriesId,
      2,
      user,
      new Date(),
    );

    expect(transaction).not.toHaveBeenCalled();
    expect(result.map((s) => s.id)).toEqual(["s-1", "s-2"]);
  });

  it("throws NotFoundException when the series doesn't exist / isn't a TASK series / isn't the user's", async () => {
    const seriesFindFirst = jest.fn().mockResolvedValue(null);
    const prisma = {
      sessionSeries: { findFirst: seriesFindFirst },
      session: { findMany: jest.fn() },
    };
    const placement = {
      canPlaceSeries: jest.fn(),
      placeSeriesOnCreate: jest.fn(),
    };
    const service = await makeSeriesService(
      prisma,
      { resolveTagIds: jest.fn() },
      placement,
    );

    await expect(
      service.resizeSessionCount("nope", 3, user, new Date()),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("SeriesService.promoteToSeries", () => {
  it("creates a new SessionSeries and backfills seriesId/sessionIndex/sessionTotal onto the existing row", async () => {
    const deadline = new Date("2026-07-01T00:00:00.000Z");
    const seriesCreate = jest.fn().mockResolvedValue({ id: "new-series-1" });
    const sessionUpdate = jest.fn().mockResolvedValue({});
    const prisma = {
      $transaction: (fn: (t: unknown) => unknown) =>
        fn({
          sessionSeries: { create: seriesCreate },
          session: { update: sessionUpdate },
        }),
    };
    const service = await makeSeriesService(
      prisma,
      { resolveTagIds: jest.fn() },
      { canPlaceSeries: jest.fn(), placeSeriesOnCreate: jest.fn() },
    );

    const seriesId = await service.promoteToSeries("plain-1", deadline, user);

    expect(seriesId).toBe("new-series-1");
    expect(seriesCreate).toHaveBeenCalledWith({
      data: { type: "TASK", rrule: null, deadline, userId: user.id },
    });
    expect(sessionUpdate).toHaveBeenCalledWith({
      where: { id: "plain-1" },
      data: { seriesId: "new-series-1", sessionIndex: 1, sessionTotal: 1 },
    });
  });
});
