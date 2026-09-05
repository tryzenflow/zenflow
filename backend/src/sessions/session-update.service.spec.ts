import { SessionUpdateService } from "./session-update.service";
import { occurrenceId } from "../scheduler/core/recurrence";
import { DAY_MS } from "../scheduler/core/slot";
import type { Tag, Session, SessionSeries, User } from "../../generated/prisma";
import type { UpdateSessionDto } from "./dto/update-session.dto";

/**
 * Focused coverage for `SessionUpdateService`'s `scope`/`skipConflicting`
 * branching (the drag/resize confirmation-sheet feature). `sessions.service.spec.ts`
 * already covers the plain per-row PATCH / MOVE telemetry / deadline-redistribute
 * paths end to end through the full `SessionsService` facade — these tests isolate
 * just the new routing, with `SeriesService` stubbed so each branch's delegation
 * (or lack thereof) can be asserted directly.
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
    durationMinutes: 60,
    deadline: null,
    tags: [],
    series: null,
    type: "LECTURE",
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

function fakeSeries() {
  return {
    updateSiblingTimeOfDay: jest.fn(),
    updateRecurringFollowing: jest.fn(),
    redistribute: jest.fn(),
    excludeOccurrence: jest.fn().mockResolvedValue({ id: "noop" }),
  };
}

function fakeTagsService() {
  return { resolveTagIds: jest.fn().mockResolvedValue([]) };
}

function fakeTaskPlacement() {
  return {
    placeOnDeadlineChange: jest
      .fn()
      .mockResolvedValue({ scheduledStartTime: null, appliedPolicy: "NONE" }),
  };
}

function fakeSchedulingFeedback() {
  return { onFirstMove: jest.fn().mockResolvedValue(undefined) };
}

function makeService(
  prisma: never,
  series: ReturnType<typeof fakeSeries> = fakeSeries(),
) {
  return new SessionUpdateService(
    prisma,
    fakeTagsService() as never,
    fakeTaskPlacement() as never,
    fakeSchedulingFeedback() as never,
    series as never,
  );
}

describe("SessionUpdateService — no scope (regression: byte-for-byte unchanged)", () => {
  it("a title-only diff never touches SeriesService's new scope methods", async () => {
    const existing = session({ id: "session-1", title: "Old" });
    const updated = session({ id: "session-1", title: "New" });
    const findFirst = jest.fn().mockResolvedValue(existing);
    const update = jest.fn().mockResolvedValue(updated);
    const prisma = {
      $transaction: (fn: (t: unknown) => unknown) =>
        fn({
          session: { findFirst, update },
          sessionEvent: { create: jest.fn() },
        }),
    };
    const series = fakeSeries();
    const service = makeService(prisma as never, series);

    const result = await service.update("session-1", { title: "New" }, user);

    expect(series.updateSiblingTimeOfDay).not.toHaveBeenCalled();
    expect(series.updateRecurringFollowing).not.toHaveBeenCalled();
    expect(result.title).toBe("New");
    expect(result.skippedSessionIds).toBeUndefined();
  });

  it("a reschedule with scope omitted on a TASK-series sitting patches only that row (today's default)", async () => {
    const existing = session({
      id: "sit-2",
      type: "TASK",
      seriesId: "task-series-1",
      sessionIndex: 2,
      sessionTotal: 3,
      scheduledStartTime: new Date("2026-06-11T08:00:00.000Z"),
    });
    const updated = {
      ...existing,
      scheduledStartTime: new Date("2026-06-11T09:00:00.000Z"),
    };
    const findFirst = jest.fn().mockResolvedValue(existing);
    const update = jest.fn().mockResolvedValue(updated);
    const prisma = {
      $transaction: (fn: (t: unknown) => unknown) =>
        fn({
          session: { findFirst, update },
          sessionEvent: { create: jest.fn().mockResolvedValue({ id: 1n }) },
        }),
    };
    const series = fakeSeries();
    const service = makeService(prisma as never, series);

    await service.update(
      "sit-2",
      { scheduledStartTime: "2026-06-11T09:00:00.000Z" },
      user,
    );

    expect(series.updateSiblingTimeOfDay).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "sit-2" } }),
    );
  });
});

describe("SessionUpdateService — TASK-series sitting, scope following/series", () => {
  it("scope 'following' delegates to updateSiblingTimeOfDay with scopeAll=false, short-circuiting the plain PATCH", async () => {
    const findFirst = jest.fn().mockResolvedValue({
      seriesId: "task-series-1",
      scheduledStartTime: new Date("2026-06-11T08:00:00.000Z"),
      series: { type: "TASK" },
    });
    const transaction = jest.fn();
    const prisma = { session: { findFirst }, $transaction: transaction };
    const series = fakeSeries();
    const returnedSessions = [
      { id: "sit-2", title: "X" },
      { id: "sit-3", title: "X" },
    ];
    series.updateSiblingTimeOfDay.mockResolvedValue({
      sessions: returnedSessions,
      skippedSessionIds: [],
    });
    const service = makeService(prisma as never, series);

    const dto: UpdateSessionDto = {
      scheduledStartTime: "2026-06-11T09:30:00.000Z",
      durationMinutes: 90,
      scope: "following",
    };
    const result = await service.update("sit-2", dto, user);

    expect(transaction).not.toHaveBeenCalled();
    expect(series.updateSiblingTimeOfDay).toHaveBeenCalledWith(
      "task-series-1",
      "sit-2",
      { timeOfDayMinutes: 9 * 60 + 30, durationMinutes: 90 },
      false,
      false,
      user,
    );
    expect(result.sessions).toBe(returnedSessions);
    expect(result.id).toBe("sit-2");
    expect(result.skippedSessionIds).toBeUndefined();
  });

  it("scope 'series' passes scopeAll=true and skipConflicting=true through", async () => {
    const findFirst = jest.fn().mockResolvedValue({
      seriesId: "task-series-1",
      scheduledStartTime: new Date("2026-06-11T08:00:00.000Z"),
      series: { type: "TASK" },
    });
    const prisma = { session: { findFirst }, $transaction: jest.fn() };
    const series = fakeSeries();
    series.updateSiblingTimeOfDay.mockResolvedValue({
      sessions: [{ id: "sit-2" }],
      skippedSessionIds: ["sit-3"],
    });
    const service = makeService(prisma as never, series);

    const dto: UpdateSessionDto = {
      scheduledStartTime: "2026-06-11T09:30:00.000Z",
      durationMinutes: 90,
      scope: "series",
      skipConflicting: true,
    };
    const result = await service.update("sit-2", dto, user);

    expect(series.updateSiblingTimeOfDay).toHaveBeenCalledWith(
      "task-series-1",
      "sit-2",
      { timeOfDayMinutes: 9 * 60 + 30, durationMinutes: 90 },
      true,
      true,
      user,
    );
    expect(result.skippedSessionIds).toEqual(["sit-3"]);
  });

  it("a duration-only resize derives time-of-day from the sitting's own current start", async () => {
    const findFirst = jest.fn().mockResolvedValue({
      seriesId: "task-series-1",
      scheduledStartTime: new Date("2026-06-11T14:15:00.000Z"),
      series: { type: "TASK" },
    });
    const prisma = { session: { findFirst }, $transaction: jest.fn() };
    const series = fakeSeries();
    series.updateSiblingTimeOfDay.mockResolvedValue({
      sessions: [],
      skippedSessionIds: [],
    });
    const service = makeService(prisma as never, series);

    await service.update(
      "sit-2",
      { durationMinutes: 120, scope: "following" },
      user,
    );

    expect(series.updateSiblingTimeOfDay).toHaveBeenCalledWith(
      "task-series-1",
      "sit-2",
      { timeOfDayMinutes: 14 * 60 + 15, durationMinutes: 120 },
      false,
      false,
      user,
    );
  });

  it("scope without a schedule/duration change (metadata-only) does NOT delegate — falls through to the plain PATCH", async () => {
    const existingForScope = jest.fn().mockResolvedValue({
      seriesId: "task-series-1",
      scheduledStartTime: new Date("2026-06-11T08:00:00.000Z"),
      series: { type: "TASK" },
    });
    const existing = session({
      id: "sit-2",
      type: "TASK",
      seriesId: "task-series-1",
    });
    const updated = session({ id: "sit-2", type: "TASK", title: "New" });
    const txFindFirst = jest.fn().mockResolvedValue(existing);
    const update = jest.fn().mockResolvedValue(updated);
    const prisma = {
      session: { findFirst: existingForScope },
      $transaction: (fn: (t: unknown) => unknown) =>
        fn({
          session: { findFirst: txFindFirst, update },
          sessionEvent: { create: jest.fn() },
        }),
    };
    const series = fakeSeries();
    const service = makeService(prisma as never, series);

    const result = await service.update(
      "sit-2",
      { title: "New", scope: "following" },
      user,
    );

    expect(series.updateSiblingTimeOfDay).not.toHaveBeenCalled();
    expect(result.title).toBe("New");
  });

  it("scope 'following' on a session with no series falls through to the plain PATCH", async () => {
    const existingForScope = jest.fn().mockResolvedValue({
      seriesId: null,
      scheduledStartTime: new Date("2026-06-11T08:00:00.000Z"),
      series: null,
    });
    const existing = session({ id: "plain-1", type: "TASK" });
    const updated = session({
      id: "plain-1",
      type: "TASK",
      scheduledStartTime: new Date("2026-06-11T09:00:00.000Z"),
    });
    const txFindFirst = jest.fn().mockResolvedValue(existing);
    const update = jest.fn().mockResolvedValue(updated);
    const prisma = {
      session: { findFirst: existingForScope },
      $transaction: (fn: (t: unknown) => unknown) =>
        fn({
          session: { findFirst: txFindFirst, update },
          sessionEvent: { create: jest.fn().mockResolvedValue({ id: 1n }) },
        }),
    };
    const series = fakeSeries();
    const service = makeService(prisma as never, series);

    await service.update(
      "plain-1",
      {
        scheduledStartTime: "2026-06-11T09:00:00.000Z",
        scope: "following",
      },
      user,
    );

    expect(series.updateSiblingTimeOfDay).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalled();
  });
});

describe("SessionUpdateService — recurring occurrence, scope 'following'", () => {
  it("delegates to updateRecurringFollowing, short-circuiting the representative-row reanchor", async () => {
    const findFirst = jest.fn().mockResolvedValue({
      scheduledStartTime: new Date("2026-06-01T09:00:00.000Z"),
      durationMinutes: 90,
    });
    const transaction = jest.fn();
    const prisma = { session: { findFirst }, $transaction: transaction };
    const series = fakeSeries();
    series.updateRecurringFollowing.mockResolvedValue({
      session: { id: "new-rep-1", title: "Lecture" },
      skippedSessionIds: [],
    });
    const service = makeService(prisma as never, series);

    const occId = occurrenceId(
      "lecture-series-1",
      new Date("2026-06-08T09:00:00.000Z"),
    );
    const dto: UpdateSessionDto = {
      scheduledStartTime: "2026-06-08T10:00:00.000Z",
      durationMinutes: 60,
      scope: "following",
      skipConflicting: true,
    };
    const result = await service.update(occId, dto, user);

    expect(transaction).not.toHaveBeenCalled();
    expect(series.updateRecurringFollowing).toHaveBeenCalledWith(
      "lecture-series-1",
      "2026-06-08T09:00:00.000Z",
      { scheduledStartTime: "2026-06-08T10:00:00.000Z", durationMinutes: 60 },
      true,
      user,
    );
    expect(result.id).toBe("new-rep-1");
    expect(result.skippedSessionIds).toBeUndefined();
  });

  it("surfaces skippedSessionIds returned by updateRecurringFollowing", async () => {
    const findFirst = jest.fn().mockResolvedValue({
      scheduledStartTime: new Date("2026-06-01T09:00:00.000Z"),
      durationMinutes: 90,
    });
    const prisma = { session: { findFirst }, $transaction: jest.fn() };
    const series = fakeSeries();
    series.updateRecurringFollowing.mockResolvedValue({
      session: { id: "new-rep-1" },
      skippedSessionIds: ["new-rep-1::2026-06-15T10:00:00.000Z"],
    });
    const service = makeService(prisma as never, series);

    const occId = occurrenceId(
      "lecture-series-1",
      new Date("2026-06-08T09:00:00.000Z"),
    );
    const result = await service.update(
      occId,
      {
        scheduledStartTime: "2026-06-08T10:00:00.000Z",
        durationMinutes: 60,
        scope: "following",
        skipConflicting: true,
      },
      user,
    );

    expect(result.skippedSessionIds).toEqual([
      "new-rep-1::2026-06-15T10:00:00.000Z",
    ]);
  });
});

describe("SessionUpdateService — recurring occurrence, scope 'series' (or omitted) + skipConflicting", () => {
  it("prunes a future occurrence whose new landing would conflict into the series' exdates", async () => {
    // Anchor tomorrow at 09:00 UTC, daily — guarantees occurrences fall inside
    // the [now, now+MAX_SCAN_DAYS] window regardless of the exact instant the
    // service reads `now` at.
    const anchor = new Date(Date.now() + DAY_MS);
    anchor.setUTCHours(9, 0, 0, 0);
    const rrule = "FREQ=DAILY;COUNT=3";
    const seriesRow: SessionSeries = {
      id: "lecture-series-1",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      type: "LECTURE",
      deadline: null,
      rrule,
      exdates: [],
      userId: user.id,
    };
    const existing = session({
      id: "rep-1",
      type: "LECTURE",
      seriesId: "lecture-series-1",
      series: seriesRow,
      scheduledStartTime: anchor,
      durationMinutes: 90,
    });
    // The PATCH itself doesn't change the time (title/duration untouched) —
    // this test targets the pruning pass in isolation.
    const updated = existing;

    const txFindFirst = jest.fn().mockResolvedValue(existing);
    const update = jest.fn().mockResolvedValue(updated);

    // The second day's landing collides with another session; the 1st/3rd
    // days are free.
    const collidingDay = new Date(anchor.getTime() + DAY_MS);
    const sessionFindMany = jest.fn(
      (args: {
        where: { scheduledStartTime?: { gte?: Date; lte?: Date } };
      }) => {
        const gte = args.where.scheduledStartTime?.gte?.getTime() ?? 0;
        const lte = args.where.scheduledStartTime?.lte?.getTime() ?? Infinity;
        const t = collidingDay.getTime();
        if (t >= gte && t <= lte) {
          return Promise.resolve([
            {
              scheduledStartTime: collidingDay,
              durationMinutes: 30,
              type: "TASK",
            },
          ]);
        }
        return Promise.resolve([]);
      },
    );
    const seriesFindMany = jest.fn().mockResolvedValue([]);
    const repFindFirst = jest
      .fn()
      .mockResolvedValue({ id: "rep-1", scheduledStartTime: anchor });

    const prisma = {
      session: { findFirst: repFindFirst, findMany: sessionFindMany },
      sessionSeries: { findMany: seriesFindMany },
      $transaction: (fn: (t: unknown) => unknown) =>
        fn({
          session: { findFirst: txFindFirst, update },
          sessionEvent: { create: jest.fn() },
        }),
    };
    const series = fakeSeries();
    const service = makeService(prisma as never, series);

    const occId = occurrenceId("lecture-series-1", anchor);
    const result = await service.update(occId, { skipConflicting: true }, user);

    expect(series.excludeOccurrence).toHaveBeenCalledTimes(1);
    expect(series.excludeOccurrence).toHaveBeenCalledWith(
      "lecture-series-1",
      collidingDay.toISOString(),
      user,
    );
    expect(result.skippedSessionIds).toEqual([
      occurrenceId("lecture-series-1", collidingDay),
    ]);
  });

  it("does not prune anything when skipConflicting is left false (today's default)", async () => {
    const anchor = new Date(Date.now() + DAY_MS);
    anchor.setUTCHours(9, 0, 0, 0);
    const seriesRow: SessionSeries = {
      id: "lecture-series-1",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      type: "LECTURE",
      deadline: null,
      rrule: "FREQ=DAILY;COUNT=3",
      exdates: [],
      userId: user.id,
    };
    const existing = session({
      id: "rep-1",
      type: "LECTURE",
      seriesId: "lecture-series-1",
      series: seriesRow,
      scheduledStartTime: anchor,
      durationMinutes: 90,
    });
    const txFindFirst = jest.fn().mockResolvedValue(existing);
    const update = jest.fn().mockResolvedValue(existing);
    const sessionFindMany = jest.fn();
    const repFindFirst = jest
      .fn()
      .mockResolvedValue({ id: "rep-1", scheduledStartTime: anchor });
    const prisma = {
      session: { findFirst: repFindFirst, findMany: sessionFindMany },
      sessionSeries: { findMany: jest.fn() },
      $transaction: (fn: (t: unknown) => unknown) =>
        fn({
          session: { findFirst: txFindFirst, update },
          sessionEvent: { create: jest.fn() },
        }),
    };
    const series = fakeSeries();
    const service = makeService(prisma as never, series);

    const occId = occurrenceId("lecture-series-1", anchor);
    const result = await service.update(occId, { title: "New" }, user);

    expect(sessionFindMany).not.toHaveBeenCalled();
    expect(series.excludeOccurrence).not.toHaveBeenCalled();
    expect(result.skippedSessionIds).toBeUndefined();
  });
});
