/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { SessionsService } from "./sessions.service";
import { SessionCrudService } from "./session-crud.service";
import { SeriesService } from "./series.service";
import { SessionUpdateService } from "./session-update.service";
import type { Tag, Session, SessionSeries, User } from "../../generated/prisma";
import type { CreateSessionDto } from "./dto/create-session.dto";
import type { UpdateSessionDto } from "./dto/update-session.dto";

/**
 * Focused coverage for `SessionsService`: DTO mapping, the per-type `create`
 * branches, the single-session placement on create / deadline change (no day
 * repack — nothing else moves), the `TASK`-series batch path, and the `MOVE`
 * telemetry emitted when a user drags/resizes a scheduled TASK.
 */

type SessionRow = Session & { tags: Tag[]; series: SessionSeries | null };

interface CreateCall {
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
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
} as unknown as User;

function session(overrides: Partial<SessionRow> & { id: string }): SessionRow {
  return {
    title: "Session",
    note: null,
    durationMinutes: 60,
    deadline: new Date("2026-01-05T12:00:00.000Z"),
    tags: [],
    series: null,
    type: "TASK",
    source: "USER",
    conflict: false,
    scheduledStartTime: null,
    lastMovedAt: null,
    retainedAt: null,
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

function fakeTagsService() {
  return {
    resolveTagIds: jest.fn(
      (_tx: unknown, _userId: string, names: string[]): Promise<string[]> =>
        Promise.resolve(names.map((n) => `tag-${n}`)),
    ),
  };
}

/**
 * The scheduler facade (`TaskPlacementService`) — stubbed to "placed nothing"
 * by default. Every heuristic / LinUCB / SlotProposal detail lives behind it
 * and is covered by `scheduler/io/*.spec.ts`.
 */
function fakeTaskPlacement() {
  return {
    // Pre-flight feasibility — "feasible" by default so the existing
    // create-success assertions below don't have to opt in.
    canPlaceTask: jest.fn().mockResolvedValue(true),
    canPlaceSeries: jest.fn().mockResolvedValue(true),
    placeOnCreate: jest
      .fn()
      .mockResolvedValue({ scheduledStartTime: null, appliedPolicy: "NONE" }),
    placeOnDeadlineChange: jest
      .fn()
      .mockResolvedValue({ scheduledStartTime: null, appliedPolicy: "NONE" }),
    placeSeriesOnCreate: jest.fn().mockResolvedValue([]),
    redistributeSeries: jest.fn().mockResolvedValue([]),
  };
}

/** The delayed first-move LinUCB reward writer. */
function fakeSchedulingFeedback() {
  return { onFirstMove: jest.fn().mockResolvedValue(undefined) };
}

/**
 * Wire the facade to real collaborators (they're thin) over the fake prisma /
 * tags / placement / feedback doubles, so every existing behavioural assertion
 * still exercises the delegation path end to end.
 */
function makeService(
  prisma: never,
  tags: never,
  placement: never = fakeTaskPlacement() as never,
  feedback: never = fakeSchedulingFeedback() as never,
) {
  const series = new SeriesService(prisma, tags, placement);
  const crud = new SessionCrudService(prisma, tags, placement, series);
  const updates = new SessionUpdateService(
    prisma,
    tags,
    placement,
    feedback,
    series,
  );
  return new SessionsService(crud, series, updates);
}

/** Build a prisma double whose `$transaction` runs against the given tx double. */
function prismaWithTx(tx: Record<string, unknown>) {
  return {
    $transaction: (fn: (t: unknown) => unknown) => fn(tx),
  };
}

describe("SessionsService.create", () => {
  it("TASK: inserts the row, writes a CREATE event, places it in its best slot, maps the wire shape", async () => {
    const created = session({
      id: "session-1",
      title: "Write report",
      durationMinutes: 30,
      deadline: new Date("2026-06-10T17:00:00.000Z"),
      tags: [tagRow("work")],
    });
    const sessionCreate = jest.fn((args: CreateCall): Promise<SessionRow> => {
      void args;
      return Promise.resolve(created);
    });
    const eventCreate = jest.fn().mockResolvedValue({});
    const prisma = prismaWithTx({
      session: { create: sessionCreate },
      sessionEvent: { create: eventCreate },
    });
    const tagsService = fakeTagsService();
    const placement = fakeTaskPlacement();
    const service = makeService(
      prisma as never,
      tagsService as never,
      placement as never,
      fakeSchedulingFeedback() as never,
    );

    const dto = {
      type: "TASK",
      title: "Write report",
      durationMinutes: 30,
      deadline: "2026-06-10T17:00:00.000Z",
      tags: ["work"],
    } as CreateSessionDto;
    const result = await service.create(dto, user);

    const [createArgs] = sessionCreate.mock.calls[0];
    expect(createArgs.data.type).toBe("TASK");
    expect(createArgs.data.deadline).toEqual(
      new Date("2026-06-10T17:00:00.000Z"),
    );
    expect(createArgs.data.tags).toEqual({ connect: [{ id: "tag-work" }] });

    expect(eventCreate).toHaveBeenCalledTimes(1);
    expect(eventCreate.mock.calls[0][0].data.eventType).toBe("CREATE");

    expect(placement.placeOnCreate).toHaveBeenCalledWith({
      user,
      task: {
        id: "session-1",
        durationMinutes: 30,
        deadline: new Date("2026-06-10T17:00:00.000Z"),
      },
      now: expect.any(Date),
    });

    expect(result).toEqual({
      id: "session-1",
      title: "Write report",
      note: null,
      durationMinutes: 30,
      deadline: "2026-06-10T17:00:00.000Z",
      type: "TASK",
      source: "USER",
      tags: ["work"],
      scheduledStartTime: null,
      seriesId: null,
      rrule: null,
      sessionIndex: null,
      sessionTotal: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("TASK: surfaces the slot the placement facade returns", async () => {
    const created = session({
      id: "session-1",
      deadline: new Date("2026-06-10T17:00:00.000Z"),
    });
    const slot = new Date("2026-06-10T09:00:00.000Z");
    const prisma = prismaWithTx({
      session: { create: jest.fn().mockResolvedValue(created) },
      sessionEvent: { create: jest.fn().mockResolvedValue({}) },
    });
    const placement = fakeTaskPlacement();
    placement.placeOnCreate.mockResolvedValue({
      scheduledStartTime: slot,
      appliedPolicy: "HEURISTIC",
    });
    const service = makeService(
      prisma as never,
      fakeTagsService() as never,
      placement as never,
      fakeSchedulingFeedback() as never,
    );

    const dto: CreateSessionDto = {
      type: "TASK",
      title: "X",
      durationMinutes: 60,
      deadline: "2026-06-10T17:00:00.000Z",
    };
    const result = await service.create(dto, user);

    expect(result.scheduledStartTime).toBe(slot.toISOString());
  });

  it("TASK series (sessionCount > 1): one SessionSeries + N rows, handed to the series placer", async () => {
    const rows = [
      session({
        id: "s-1",
        seriesId: "series-1",
        sessionIndex: 1,
        sessionTotal: 3,
      }),
      session({
        id: "s-2",
        seriesId: "series-1",
        sessionIndex: 2,
        sessionTotal: 3,
      }),
      session({
        id: "s-3",
        seriesId: "series-1",
        sessionIndex: 3,
        sessionTotal: 3,
      }),
    ];
    let n = 0;
    const sessionCreate = jest.fn(() => Promise.resolve(rows[n++]));
    const seriesCreate = jest
      .fn()
      .mockResolvedValue({ id: "series-1", type: "TASK" });
    const eventCreate = jest.fn().mockResolvedValue({});
    const sessionUpdate = jest.fn().mockResolvedValue({});
    const prisma = {
      $transaction: (arg: unknown) =>
        typeof arg === "function"
          ? (arg as (t: unknown) => unknown)({
              session: { create: sessionCreate },
              sessionEvent: { create: eventCreate },
              sessionSeries: { create: seriesCreate },
            })
          : Promise.all(arg as Promise<unknown>[]),
      session: { update: sessionUpdate },
    };
    const placement = fakeTaskPlacement();
    placement.placeSeriesOnCreate.mockResolvedValue([
      { id: "s-1", scheduledStartTime: new Date("2026-06-02T09:00:00.000Z") },
      { id: "s-2", scheduledStartTime: new Date("2026-06-05T09:00:00.000Z") },
      { id: "s-3", scheduledStartTime: null },
    ]);
    const service = makeService(
      prisma as never,
      fakeTagsService() as never,
      placement as never,
      fakeSchedulingFeedback() as never,
    );

    const dto: CreateSessionDto = {
      type: "TASK",
      title: "Exam prep",
      durationMinutes: 60,
      deadline: "2026-06-08T00:00:00.000Z",
      sessionCount: 3,
    };
    const result = await service.create(dto, user);

    expect(seriesCreate).toHaveBeenCalledTimes(1);
    expect(seriesCreate.mock.calls[0][0].data.type).toBe("TASK");
    expect(seriesCreate.mock.calls[0][0].data.rrule).toBeNull();
    expect(sessionCreate).toHaveBeenCalledTimes(3);
    expect(placement.placeSeriesOnCreate).toHaveBeenCalledWith({
      user,
      seriesId: "series-1",
      members: [
        { id: "s-1", durationMinutes: 60 },
        { id: "s-2", durationMinutes: 60 },
        { id: "s-3", durationMinutes: 60 },
      ],
      deadline: new Date("2026-06-08T00:00:00.000Z"),
      now: expect.any(Date),
    });
    expect(result.sessions).toHaveLength(3);
    expect(result.sessions!.map((s) => s.scheduledStartTime)).toEqual([
      "2026-06-02T09:00:00.000Z",
      "2026-06-05T09:00:00.000Z",
      null,
    ]);
    // Top-level fields mirror the first session.
    expect(result.id).toBe("s-1");
    // All 3 CREATE events are tagged with the shared series id, which also
    // rides back on every response row and groups the batch for revert.
    expect(result.sessions!.every((s) => s.seriesId === "series-1")).toBe(true);
    const seriesIds = eventCreate.mock.calls.map(
      (c) => (c[0].data as { seriesId?: string }).seriesId,
    );
    expect(seriesIds).toEqual(["series-1", "series-1", "series-1"]);
  });

  it("TASK: rejects and creates nothing when no slot fits before the deadline", async () => {
    const sessionCreate = jest.fn();
    const eventCreate = jest.fn();
    const prisma = prismaWithTx({
      session: { create: sessionCreate },
      sessionEvent: { create: eventCreate },
    });
    const placement = fakeTaskPlacement();
    placement.canPlaceTask.mockResolvedValue(false);
    const service = makeService(
      prisma as never,
      fakeTagsService() as never,
      placement as never,
      fakeSchedulingFeedback() as never,
    );

    const dto: CreateSessionDto = {
      type: "TASK",
      title: "Too tight",
      durationMinutes: 60,
      deadline: "2026-06-10T17:00:00.000Z",
    };

    await expect(service.create(dto, user)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(sessionCreate).not.toHaveBeenCalled();
    expect(eventCreate).not.toHaveBeenCalled();
    expect(placement.placeOnCreate).not.toHaveBeenCalled();
  });

  it("TASK series: rejects and creates nothing when any member has no feasible slot", async () => {
    const sessionCreate = jest.fn();
    const seriesCreate = jest.fn();
    const eventCreate = jest.fn();
    const prisma = {
      $transaction: (fn: (t: unknown) => unknown) =>
        fn({
          session: { create: sessionCreate },
          sessionEvent: { create: eventCreate },
          sessionSeries: { create: seriesCreate },
        }),
    };
    const placement = fakeTaskPlacement();
    placement.canPlaceSeries.mockResolvedValue(false);
    const service = makeService(
      prisma as never,
      fakeTagsService() as never,
      placement as never,
      fakeSchedulingFeedback() as never,
    );

    const dto: CreateSessionDto = {
      type: "TASK",
      title: "Exam prep",
      durationMinutes: 60,
      deadline: "2026-06-08T00:00:00.000Z",
      sessionCount: 5,
    };

    await expect(service.create(dto, user)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(placement.canPlaceSeries).toHaveBeenCalledWith(
      expect.objectContaining({ sessionCount: 5, durationMinutes: 60 }),
    );
    expect(seriesCreate).not.toHaveBeenCalled();
    expect(sessionCreate).not.toHaveBeenCalled();
    expect(eventCreate).not.toHaveBeenCalled();
    expect(placement.placeSeriesOnCreate).not.toHaveBeenCalled();
  });

  it("ASSIGNMENT: pins scheduledStartTime, leaves deadline null, never runs a placer", async () => {
    const created = session({
      id: "a-1",
      type: "ASSIGNMENT",
      deadline: null,
      scheduledStartTime: new Date("2026-06-12T09:00:00.000Z"),
    });
    const sessionCreate = jest.fn().mockResolvedValue(created);
    const prisma = prismaWithTx({
      session: { create: sessionCreate },
      sessionEvent: { create: jest.fn().mockResolvedValue({}) },
    });
    const placement = fakeTaskPlacement();
    const service = makeService(
      prisma as never,
      fakeTagsService() as never,
      placement as never,
      fakeSchedulingFeedback() as never,
    );

    const dto = {
      type: "ASSIGNMENT",
      title: "Essay",
      durationMinutes: 90,
      scheduledStartTime: "2026-06-12T09:00:00.000Z",
    } as CreateSessionDto;
    const result = await service.create(dto, user);

    const [createArgs] = sessionCreate.mock.calls[0];
    expect(createArgs.data.type).toBe("ASSIGNMENT");
    expect(createArgs.data.deadline).toBeNull();
    expect(result.deadline).toBeNull();
    expect(result.type).toBe("ASSIGNMENT");
    expect(placement.placeOnCreate).not.toHaveBeenCalled();
  });

  it("DND + rrule: creates a series and a representative row at the first occurrence", async () => {
    const series: SessionSeries = {
      id: "series-1",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      type: "DND",
      deadline: null,
      rrule: "FREQ=WEEKLY;BYDAY=MO",
      exdates: [],
      userId: user.id,
    };
    const created = session({
      id: "dnd-1",
      type: "DND",
      deadline: null,
      seriesId: "series-1",
      series,
      scheduledStartTime: new Date("2026-06-15T12:00:00.000Z"),
    });
    const seriesCreate = jest.fn().mockResolvedValue(series);
    const sessionCreate = jest.fn().mockResolvedValue(created);
    const prisma = prismaWithTx({
      sessionSeries: { create: seriesCreate },
      session: { create: sessionCreate },
      sessionEvent: { create: jest.fn().mockResolvedValue({}) },
    });
    const placement = fakeTaskPlacement();
    const service = makeService(
      prisma as never,
      fakeTagsService() as never,
      placement as never,
      fakeSchedulingFeedback() as never,
    );

    const dto = {
      type: "DND",
      title: "Gym",
      durationMinutes: 60,
      scheduledStartTime: "2026-06-15T12:00:00.000Z",
      rrule: "FREQ=WEEKLY;BYDAY=MO",
    } as CreateSessionDto;
    const result = await service.create(dto, user);

    expect(seriesCreate).toHaveBeenCalledTimes(1);
    expect(seriesCreate.mock.calls[0][0].data.rrule).toBe(
      "FREQ=WEEKLY;BYDAY=MO",
    );
    expect(sessionCreate.mock.calls[0][0].data.seriesId).toBe("series-1");
    expect(result.rrule).toBe("FREQ=WEEKLY;BYDAY=MO");
    expect(result.seriesId).toBe("series-1");
    expect(placement.placeOnCreate).not.toHaveBeenCalled();
  });

  it("LECTURE + rrule: a timetable type recurs the same way DND does", async () => {
    const series: SessionSeries = {
      id: "series-2",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      type: "LECTURE",
      deadline: null,
      rrule: "FREQ=WEEKLY;BYDAY=MO,WE",
      exdates: [],
      userId: user.id,
    };
    const created = session({
      id: "lec-1",
      type: "LECTURE",
      deadline: null,
      seriesId: "series-2",
      series,
      scheduledStartTime: new Date("2026-09-07T07:00:00.000Z"),
    });
    const seriesCreate = jest.fn().mockResolvedValue(series);
    const sessionCreate = jest.fn().mockResolvedValue(created);
    const prisma = prismaWithTx({
      sessionSeries: { create: seriesCreate },
      session: { create: sessionCreate },
      sessionEvent: { create: jest.fn().mockResolvedValue({}) },
    });
    const placement = fakeTaskPlacement();
    const service = makeService(
      prisma as never,
      fakeTagsService() as never,
      placement as never,
      fakeSchedulingFeedback() as never,
    );

    const dto = {
      type: "LECTURE",
      title: "Algorithms",
      durationMinutes: 90,
      scheduledStartTime: "2026-09-07T07:00:00.000Z",
      rrule: "FREQ=WEEKLY;BYDAY=MO,WE",
    } as CreateSessionDto;
    const result = await service.create(dto, user);

    expect(seriesCreate.mock.calls[0][0].data.type).toBe("LECTURE");
    expect(sessionCreate.mock.calls[0][0].data.type).toBe("LECTURE");
    expect(sessionCreate.mock.calls[0][0].data.deadline).toBeNull();
    expect(result.seriesId).toBe("series-2");
    expect(result.rrule).toBe("FREQ=WEEKLY;BYDAY=MO,WE");
    expect(placement.placeOnCreate).not.toHaveBeenCalled();
  });
});

describe("SessionsService.list", () => {
  it("scopes the query to the user", async () => {
    const rows = [session({ id: "session-1" })];
    const findMany = jest.fn().mockResolvedValue(rows);
    const prisma = { session: { findMany } };
    const service = makeService(
      prisma as never,
      fakeTagsService() as never,
      fakeTaskPlacement() as never,
      fakeSchedulingFeedback() as never,
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

  it("expands a recurring DND representative into per-occurrence virtual rows", async () => {
    const series: SessionSeries = {
      id: "series-1",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      type: "DND",
      deadline: null,
      rrule: "FREQ=DAILY",
      exdates: [],
      userId: user.id,
    };
    const rep = session({
      id: "dnd-rep",
      type: "DND",
      deadline: null,
      seriesId: "series-1",
      series,
      scheduledStartTime: new Date("2026-06-01T12:00:00.000Z"),
    });
    const findMany = jest.fn().mockResolvedValue([rep]);
    const prisma = { session: { findMany } };
    const service = makeService(
      prisma as never,
      fakeTagsService() as never,
      fakeTaskPlacement() as never,
      fakeSchedulingFeedback() as never,
    );

    const result = await service.list(
      { view: "week", date: "2026-06-15" },
      user,
    );

    expect(result.sessions.length).toBeGreaterThan(1);
    expect(result.sessions.every((s) => s.id.startsWith("series-1::"))).toBe(
      true,
    );
    expect(result.sessions.every((s) => s.type === "DND")).toBe(true);
  });

  it("includes a plain session that starts the previous day and crosses midnight into the requested day", async () => {
    // "day" view for 2026-06-10 (UTC) — an 8h DND block starting 22:00 on
    // 2026-06-09 runs until 06:00 on 2026-06-10, so it overlaps the window.
    const crossing = session({
      id: "sleep-1",
      type: "DND",
      deadline: null,
      durationMinutes: 8 * 60,
      scheduledStartTime: new Date("2026-06-09T22:00:00.000Z"),
    });
    const findMany = jest.fn().mockResolvedValue([crossing]);
    const prisma = { session: { findMany } };
    const service = makeService(
      prisma as never,
      fakeTagsService() as never,
      fakeTaskPlacement() as never,
      fakeSchedulingFeedback() as never,
    );

    const result = await service.list(
      { view: "day", date: "2026-06-10" },
      user,
    );

    expect(result.sessions.map((s) => s.id)).toContain("sleep-1");

    // The widened lower bound is passed to the query.
    const [{ where }] = findMany.mock.calls[0] as [
      {
        where: {
          OR: Array<{ scheduledStartTime?: { gte?: Date; lte?: Date } }>;
        };
      },
    ];
    const rangedClause = where.OR.find(
      (c) => c.scheduledStartTime?.gte !== undefined,
    );
    expect(rangedClause?.scheduledStartTime?.gte).toEqual(
      new Date("2026-06-09T00:00:00.000Z"),
    );
  });

  it("excludes a plain session entirely on the previous day with no overlap into the requested day", async () => {
    const noOverlap = session({
      id: "no-overlap-1",
      durationMinutes: 60,
      scheduledStartTime: new Date("2026-06-09T10:00:00.000Z"),
    });
    // The prisma double still "returns" the row (as the widened query would),
    // to prove list() itself filters it out by the overlap guard.
    const findMany = jest.fn().mockResolvedValue([noOverlap]);
    const prisma = { session: { findMany } };
    const service = makeService(
      prisma as never,
      fakeTagsService() as never,
      fakeTaskPlacement() as never,
      fakeSchedulingFeedback() as never,
    );

    const result = await service.list(
      { view: "day", date: "2026-06-10" },
      user,
    );

    expect(result.sessions.map((s) => s.id)).not.toContain("no-overlap-1");
  });

  it("always includes an unscheduled TASK regardless of the requested window", async () => {
    const unscheduled = session({
      id: "unscheduled-1",
      type: "TASK",
      scheduledStartTime: null,
    });
    const findMany = jest.fn().mockResolvedValue([unscheduled]);
    const prisma = { session: { findMany } };
    const service = makeService(
      prisma as never,
      fakeTagsService() as never,
      fakeTaskPlacement() as never,
      fakeSchedulingFeedback() as never,
    );

    const result = await service.list(
      { view: "day", date: "2026-06-10" },
      user,
    );

    expect(result.sessions.map((s) => s.id)).toContain("unscheduled-1");
  });

  it("includes a recurring occurrence that starts the previous day and crosses midnight into the requested day", async () => {
    const series: SessionSeries = {
      id: "series-sleep",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      type: "DND",
      deadline: null,
      rrule: "FREQ=DAILY",
      exdates: [],
      userId: user.id,
    };
    const rep = session({
      id: "sleep-rep",
      type: "DND",
      deadline: null,
      durationMinutes: 8 * 60,
      seriesId: "series-sleep",
      series,
      // First occurrence anchored well before the requested window.
      scheduledStartTime: new Date("2026-06-01T22:00:00.000Z"),
    });
    const findMany = jest.fn().mockResolvedValue([rep]);
    const prisma = { session: { findMany } };
    const service = makeService(
      prisma as never,
      fakeTagsService() as never,
      fakeTaskPlacement() as never,
      fakeSchedulingFeedback() as never,
    );

    const result = await service.list(
      { view: "day", date: "2026-06-10" },
      user,
    );

    // The occurrence that started 2026-06-09T22:00Z and runs to 06:00 the
    // next day must show up for the 2026-06-10 window.
    expect(
      result.sessions.some(
        (s) => s.scheduledStartTime === "2026-06-09T22:00:00.000Z",
      ),
    ).toBe(true);
  });
});

describe("SessionsService.findById", () => {
  it("returns the mapped session when found", async () => {
    const row = session({ id: "session-1" });
    const findUnique = jest.fn().mockResolvedValue(row);
    const prisma = { session: { findUnique } };
    const service = makeService(
      prisma as never,
      fakeTagsService() as never,
      fakeTaskPlacement() as never,
      fakeSchedulingFeedback() as never,
    );

    const result = await service.findById("session-1", user);
    expect(result.id).toBe("session-1");
  });

  it("throws NotFoundException when missing", async () => {
    const findUnique = jest.fn().mockResolvedValue(null);
    const prisma = { session: { findUnique } };
    const service = makeService(
      prisma as never,
      fakeTagsService() as never,
      fakeTaskPlacement() as never,
      fakeSchedulingFeedback() as never,
    );

    await expect(service.findById("missing", user)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe("SessionsService.update", () => {
  it("applies a title-only diff, emits no event, runs no placer", async () => {
    const existing = session({ id: "session-1", title: "Old title" });
    const updated = session({ id: "session-1", title: "New title" });
    const findFirst = jest.fn().mockResolvedValue(existing);
    const update = jest.fn().mockResolvedValue(updated);
    const eventCreate = jest.fn().mockResolvedValue({});
    const prisma = prismaWithTx({
      session: { findFirst, update },
      sessionEvent: { create: eventCreate },
      slotProposal: { findFirst: () => Promise.resolve(null) },
    });
    const tagsService = fakeTagsService();
    const placement = fakeTaskPlacement();
    const service = makeService(
      prisma as never,
      tagsService as never,
      placement as never,
      fakeSchedulingFeedback() as never,
    );

    const dto: UpdateSessionDto = { title: "New title" };
    const result = await service.update("session-1", dto, user);

    expect(update.mock.calls[0][0].data).toEqual({ title: "New title" });
    expect(eventCreate).not.toHaveBeenCalled();
    expect(tagsService.resolveTagIds).not.toHaveBeenCalled();
    expect(placement.placeOnDeadlineChange).not.toHaveBeenCalled();
    expect(result.title).toBe("New title");
    expect(result.sessions).toBeUndefined();
  });

  it("dragging a scheduled TASK writes a MOVE event with drag distance and stamps lastMovedAt", async () => {
    const existing = session({
      id: "session-1",
      scheduledStartTime: new Date("2026-06-11T08:00:00.000Z"),
    });
    const moved = session({
      id: "session-1",
      scheduledStartTime: new Date("2026-06-11T09:00:00.000Z"),
    });
    const findFirst = jest.fn().mockResolvedValue(existing);
    const update = jest.fn().mockResolvedValue(moved);
    const eventCreate = jest.fn().mockResolvedValue({});
    const prisma = prismaWithTx({
      session: { findFirst, update },
      sessionEvent: { create: eventCreate },
      slotProposal: { findFirst: () => Promise.resolve(null) },
    });
    const service = makeService(
      prisma as never,
      fakeTagsService() as never,
      fakeTaskPlacement() as never,
      fakeSchedulingFeedback() as never,
    );

    await service.update(
      "session-1",
      { scheduledStartTime: "2026-06-11T09:00:00.000Z" },
      user,
    );

    expect(eventCreate).toHaveBeenCalledTimes(1);
    const ev = eventCreate.mock.calls[0][0].data;
    expect(ev.eventType).toBe("MOVE");
    expect(ev.dragDistanceMinutes).toBe(60);
    expect(ev.rewardScore).toBeLessThan(0);
    expect(update.mock.calls[0][0].data.lastMovedAt).toBeInstanceOf(Date);
  });

  it("resizing a scheduled TASK (duration only) writes a MOVE event with zero drag distance", async () => {
    const existing = session({
      id: "session-1",
      durationMinutes: 60,
      scheduledStartTime: new Date("2026-06-11T08:00:00.000Z"),
    });
    const findFirst = jest.fn().mockResolvedValue(existing);
    const update = jest.fn().mockResolvedValue(existing);
    const eventCreate = jest.fn().mockResolvedValue({});
    const prisma = prismaWithTx({
      session: { findFirst, update },
      sessionEvent: { create: eventCreate },
      slotProposal: { findFirst: () => Promise.resolve(null) },
    });
    const service = makeService(
      prisma as never,
      fakeTagsService() as never,
      fakeTaskPlacement() as never,
      fakeSchedulingFeedback() as never,
    );

    await service.update("session-1", { durationMinutes: 90 }, user);

    const ev = eventCreate.mock.calls[0][0].data;
    expect(ev.eventType).toBe("MOVE");
    expect(ev.dragDistanceMinutes).toBe(0);
  });

  it("moving a DND block emits no event", async () => {
    const existing = session({
      id: "dnd-1",
      type: "DND",
      deadline: null,
      scheduledStartTime: new Date("2026-06-11T08:00:00.000Z"),
    });
    const findFirst = jest.fn().mockResolvedValue(existing);
    const update = jest.fn().mockResolvedValue(existing);
    const eventCreate = jest.fn().mockResolvedValue({});
    const prisma = prismaWithTx({
      session: { findFirst, update },
      sessionEvent: { create: eventCreate },
      slotProposal: { findFirst: () => Promise.resolve(null) },
    });
    const service = makeService(
      prisma as never,
      fakeTagsService() as never,
      fakeTaskPlacement() as never,
      fakeSchedulingFeedback() as never,
    );

    await service.update(
      "dnd-1",
      { scheduledStartTime: "2026-06-11T10:00:00.000Z" },
      user,
    );

    expect(eventCreate).not.toHaveBeenCalled();
  });

  it("a deadline change re-places just that standalone TASK against the new deadline", async () => {
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
    const prisma = prismaWithTx({
      session: { findFirst, update },
      sessionEvent: { create: jest.fn().mockResolvedValue({}) },
    });
    const placement = fakeTaskPlacement();
    const service = makeService(
      prisma as never,
      fakeTagsService() as never,
      placement as never,
      fakeSchedulingFeedback() as never,
    );

    await service.update(
      "session-1",
      { deadline: "2026-06-12T15:30:00.000Z" },
      user,
    );

    expect(placement.placeOnDeadlineChange).toHaveBeenCalledTimes(1);
    expect(placement.placeOnDeadlineChange.mock.calls[0][0].task).toEqual({
      id: "session-1",
      durationMinutes: 60,
      deadline: new Date("2026-06-12T15:30:00.000Z"),
    });
    expect(placement.redistributeSeries).not.toHaveBeenCalled();
  });

  it("does NOT run a placer when the deadline is resubmitted unchanged", async () => {
    const sameDeadline = new Date("2026-06-10T12:00:00.000Z");
    const existing = session({ id: "session-1", deadline: sameDeadline });
    const updated = session({ id: "session-1", deadline: sameDeadline });
    const findFirst = jest.fn().mockResolvedValue(existing);
    const update = jest.fn().mockResolvedValue(updated);
    const prisma = prismaWithTx({
      session: { findFirst, update },
      sessionEvent: { create: jest.fn().mockResolvedValue({}) },
    });
    const placement = fakeTaskPlacement();
    const service = makeService(
      prisma as never,
      fakeTagsService() as never,
      placement as never,
      fakeSchedulingFeedback() as never,
    );

    const result = await service.update(
      "session-1",
      { deadline: sameDeadline.toISOString() },
      user,
    );

    expect(placement.placeOnDeadlineChange).not.toHaveBeenCalled();
    expect(result.sessions).toBeUndefined();
  });

  it("a deadline change on a series member redistributes the whole series", async () => {
    const memberRows = [
      session({
        id: "s-1",
        seriesId: "series-1",
        sessionIndex: 1,
        sessionTotal: 2,
        series: {
          id: "series-1",
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          type: "TASK",
          deadline: new Date("2026-06-20T00:00:00.000Z"),
          rrule: null,
          exdates: [],
          userId: user.id,
        },
      }),
      session({
        id: "s-2",
        seriesId: "series-1",
        sessionIndex: 2,
        sessionTotal: 2,
      }),
    ];
    const updated = {
      ...memberRows[0],
      deadline: new Date("2026-06-12T00:00:00.000Z"),
    };
    const findFirst = jest.fn().mockResolvedValue(memberRows[0]);
    const update = jest.fn().mockResolvedValue(updated);
    const findMany = jest.fn().mockResolvedValue(memberRows);
    const prisma = {
      $transaction: (arg: unknown) =>
        typeof arg === "function"
          ? (arg as (t: unknown) => unknown)({
              session: { findFirst, update },
              sessionEvent: { create: jest.fn().mockResolvedValue({}) },
            })
          : Promise.all(arg as Promise<unknown>[]),
      session: { findMany },
    };
    const placement = fakeTaskPlacement();
    placement.redistributeSeries.mockResolvedValue([
      { id: "s-1", scheduledStartTime: new Date("2026-06-02T09:00:00.000Z") },
      { id: "s-2", scheduledStartTime: new Date("2026-06-06T09:00:00.000Z") },
    ]);
    const service = makeService(
      prisma as never,
      fakeTagsService() as never,
      placement as never,
      fakeSchedulingFeedback() as never,
    );

    const result = await service.update(
      "s-1",
      { deadline: "2026-06-12T00:00:00.000Z" },
      user,
    );

    expect(placement.redistributeSeries).toHaveBeenCalledTimes(1);
    expect(placement.redistributeSeries.mock.calls[0][0]).toMatchObject({
      user,
      seriesId: "series-1",
      newDeadline: new Date("2026-06-12T00:00:00.000Z"),
    });
    expect(result.sessions).toHaveLength(2);
    expect(result.sessions!.map((s) => s.scheduledStartTime)).toEqual([
      "2026-06-02T09:00:00.000Z",
      "2026-06-06T09:00:00.000Z",
    ]);
    expect(placement.placeOnDeadlineChange).not.toHaveBeenCalled();
  });

  it("throws NotFoundException when the session doesn't belong to the user", async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const prisma = prismaWithTx({
      session: { findFirst, update: jest.fn() },
      sessionEvent: { create: jest.fn() },
    });
    const service = makeService(
      prisma as never,
      fakeTagsService() as never,
      fakeTaskPlacement() as never,
      fakeSchedulingFeedback() as never,
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
    const prisma = prismaWithTx({
      session: { findFirst, delete: del },
    });
    const service = makeService(
      prisma as never,
      fakeTagsService() as never,
      fakeTaskPlacement() as never,
      fakeSchedulingFeedback() as never,
    );

    const result = await service.remove("session-1", user);

    expect(del).toHaveBeenCalledWith({
      where: { id: "session-1", userId: user.id },
    });
    expect(result).toEqual({ id: "session-1" });
  });

  it("throws NotFoundException when the session doesn't exist", async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const prisma = prismaWithTx({
      session: { findFirst, delete: jest.fn() },
    });
    const service = makeService(
      prisma as never,
      fakeTagsService() as never,
      fakeTaskPlacement() as never,
      fakeSchedulingFeedback() as never,
    );

    await expect(service.remove("missing", user)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("a recurring occurrence ref appends its instant to the series' exdates", async () => {
    const seriesFindFirst = jest.fn().mockResolvedValue({
      id: "series-1",
      rrule: "FREQ=DAILY",
      exdates: [],
    });
    const seriesUpdate = jest.fn().mockResolvedValue({});
    const del = jest.fn();
    const prisma = {
      $transaction: (fn: (t: unknown) => unknown) =>
        fn({ session: { findFirst: jest.fn(), delete: del } }),
      sessionSeries: { findFirst: seriesFindFirst, update: seriesUpdate },
    };
    const service = makeService(
      prisma as never,
      fakeTagsService() as never,
      fakeTaskPlacement() as never,
      fakeSchedulingFeedback() as never,
    );

    const result = await service.remove(
      "series-1::2026-09-03T09:00:00.000Z",
      user,
    );

    expect(del).not.toHaveBeenCalled();
    expect(seriesUpdate).toHaveBeenCalledWith({
      where: { id: "series-1" },
      data: { exdates: { push: "2026-09-03T09:00:00.000Z" } },
    });
    expect(result).toEqual({ id: "series-1::2026-09-03T09:00:00.000Z" });
  });

  it("does not double-add an instant already in exdates", async () => {
    const seriesFindFirst = jest.fn().mockResolvedValue({
      id: "series-1",
      rrule: "FREQ=DAILY",
      exdates: ["2026-09-03T09:00:00.000Z"],
    });
    const seriesUpdate = jest.fn();
    const prisma = {
      $transaction: (fn: (t: unknown) => unknown) =>
        fn({ session: { findFirst: jest.fn(), delete: jest.fn() } }),
      sessionSeries: { findFirst: seriesFindFirst, update: seriesUpdate },
    };
    const service = makeService(
      prisma as never,
      fakeTagsService() as never,
      fakeTaskPlacement() as never,
      fakeSchedulingFeedback() as never,
    );

    await service.remove("series-1::2026-09-03T09:00:00.000Z", user);
    expect(seriesUpdate).not.toHaveBeenCalled();
  });
});

describe("SessionsService.removeSeries", () => {
  it("deletes every session (via the series cascade) and reports the ids", async () => {
    const seriesFindFirst = jest.fn().mockResolvedValue({
      id: "series-1",
      userId: user.id,
      sessions: [{ id: "s-1" }, { id: "s-2" }, { id: "s-3" }],
    });
    const seriesDelete = jest.fn().mockResolvedValue({});
    const prisma = prismaWithTx({
      sessionSeries: { findFirst: seriesFindFirst, delete: seriesDelete },
    });
    const service = makeService(
      prisma as never,
      fakeTagsService() as never,
      fakeTaskPlacement() as never,
      fakeSchedulingFeedback() as never,
    );

    const result = await service.removeSeries("series-1", user);

    expect(seriesDelete).toHaveBeenCalledWith({ where: { id: "series-1" } });
    expect(result).toEqual({
      seriesId: "series-1",
      removedSessionIds: ["s-1", "s-2", "s-3"],
      seriesGone: true,
    });
  });

  it("throws NotFoundException for a series the user does not own", async () => {
    const prisma = prismaWithTx({
      sessionSeries: {
        findFirst: jest.fn().mockResolvedValue(null),
        delete: jest.fn(),
      },
    });
    const service = makeService(
      prisma as never,
      fakeTagsService() as never,
      fakeTaskPlacement() as never,
      fakeSchedulingFeedback() as never,
    );

    await expect(service.removeSeries("nope", user)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe("SessionsService.truncateSeriesFrom", () => {
  it("pulls the rrule UNTIL back to just before the cutoff and prunes stale exdates", async () => {
    const seriesFindFirst = jest.fn().mockResolvedValue({
      id: "series-1",
      rrule: "FREQ=WEEKLY;BYDAY=MO",
      exdates: ["2026-09-07T09:00:00.000Z", "2026-10-12T09:00:00.000Z"],
      sessions: [
        {
          id: "rep-1",
          scheduledStartTime: new Date("2026-09-07T09:00:00.000Z"),
        },
      ],
    });
    const seriesUpdate = jest.fn().mockResolvedValue({});
    const seriesDelete = jest.fn();
    const prisma = prismaWithTx({
      sessionSeries: {
        findFirst: seriesFindFirst,
        update: seriesUpdate,
        delete: seriesDelete,
      },
    });
    const service = makeService(
      prisma as never,
      fakeTagsService() as never,
      fakeTaskPlacement() as never,
      fakeSchedulingFeedback() as never,
    );

    const result = await service.truncateSeriesFrom(
      "series-1",
      "2026-10-05T09:00:00.000Z",
      user,
    );

    expect(seriesDelete).not.toHaveBeenCalled();
    expect(seriesUpdate).toHaveBeenCalledWith({
      where: { id: "series-1" },
      data: {
        rrule: "FREQ=WEEKLY;BYDAY=MO;UNTIL=20261005T085959Z",
        exdates: ["2026-09-07T09:00:00.000Z"], // the Oct 12 one is now moot
      },
    });
    expect(result).toEqual({
      seriesId: "series-1",
      removedSessionIds: [],
      seriesGone: false,
    });
  });

  it("deletes the whole series when the cutoff is at or before the first occurrence", async () => {
    const seriesFindFirst = jest.fn().mockResolvedValue({
      id: "series-1",
      rrule: "FREQ=DAILY",
      exdates: [],
      sessions: [
        {
          id: "rep-1",
          scheduledStartTime: new Date("2026-09-07T09:00:00.000Z"),
        },
      ],
    });
    const seriesUpdate = jest.fn();
    const seriesDelete = jest.fn().mockResolvedValue({});
    const prisma = prismaWithTx({
      sessionSeries: {
        findFirst: seriesFindFirst,
        update: seriesUpdate,
        delete: seriesDelete,
      },
    });
    const service = makeService(
      prisma as never,
      fakeTagsService() as never,
      fakeTaskPlacement() as never,
      fakeSchedulingFeedback() as never,
    );

    const result = await service.truncateSeriesFrom(
      "series-1",
      "2026-09-07T09:00:00.000Z",
      user,
    );

    expect(seriesUpdate).not.toHaveBeenCalled();
    expect(seriesDelete).toHaveBeenCalledWith({ where: { id: "series-1" } });
    expect(result).toEqual({
      seriesId: "series-1",
      removedSessionIds: ["rep-1"],
      seriesGone: true,
    });
  });
});

describe("SessionsService.removeSeriesFrom", () => {
  const members = [
    { id: "s-1", sessionIndex: 1, createdAt: new Date("2026-01-01T00:00:00Z") },
    { id: "s-2", sessionIndex: 2, createdAt: new Date("2026-01-01T00:01:00Z") },
    { id: "s-3", sessionIndex: 3, createdAt: new Date("2026-01-01T00:02:00Z") },
  ];

  function buildService(deleteMany: jest.Mock, seriesDelete: jest.Mock) {
    const prisma = prismaWithTx({
      sessionSeries: {
        findFirst: jest.fn().mockResolvedValue({
          id: "series-1",
          userId: user.id,
          sessions: members,
        }),
        delete: seriesDelete,
      },
      session: { deleteMany },
    });
    return makeService(prisma as never, fakeTagsService() as never);
  }

  it("deletes the named session and every later one, keeps the earlier ones", async () => {
    const deleteMany = jest.fn().mockResolvedValue({ count: 2 });
    const seriesDelete = jest.fn().mockResolvedValue({});
    const service = buildService(deleteMany, seriesDelete);

    const result = await service.removeSeriesFrom("series-1", "s-2", user);

    expect(deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["s-2", "s-3"] }, userId: user.id },
    });
    expect(seriesDelete).not.toHaveBeenCalled();
    expect(result).toEqual({
      seriesId: "series-1",
      removedSessionIds: ["s-2", "s-3"],
      seriesGone: false,
    });
  });

  it("removes the series row too when the first session is the anchor", async () => {
    const deleteMany = jest.fn().mockResolvedValue({ count: 3 });
    const seriesDelete = jest.fn().mockResolvedValue({});
    const service = buildService(deleteMany, seriesDelete);

    const result = await service.removeSeriesFrom("series-1", "s-1", user);

    expect(deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["s-1", "s-2", "s-3"] }, userId: user.id },
    });
    expect(seriesDelete).toHaveBeenCalledWith({ where: { id: "series-1" } });
    expect(result.seriesGone).toBe(true);
  });

  it("throws NotFoundException when the session is not part of the series", async () => {
    const service = buildService(jest.fn(), jest.fn());
    await expect(
      service.removeSeriesFrom("series-1", "not-mine", user),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
