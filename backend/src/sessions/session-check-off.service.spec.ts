import { Test } from "@nestjs/testing";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import type { Streak } from "@zenflow/shared";
import type { SessionSeries, User } from "../../generated/prisma";
import { PrismaService } from "../prisma/prisma.service";
import { StreaksService } from "../streaks/streaks.service";
import {
  nextCheckOffState,
  SessionCheckOffService,
} from "./session-check-off.service";
import type { SessionRow } from "./types/session-row";

const user = { id: "user-1", timezone: "UTC" } as User;
const now = new Date("2026-10-14T10:00:00.000Z");
const streak: Streak = {
  current: 1,
  longest: 1,
  freezesAvailable: 0,
  frozenDays: [],
  lastActiveDay: "2026-10-14",
  todayDone: true,
};

function row(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    id: "s-1",
    title: "Study",
    note: null,
    location: null,
    durationMinutes: 60,
    deadline: new Date("2026-10-20T00:00:00.000Z"),
    type: "TASK",
    source: "USER",
    conflict: false,
    deleted: false,
    scheduledStartTime: new Date("2026-10-14T08:00:00.000Z"),
    userId: user.id,
    lastMovedAt: null,
    retainedAt: null,
    syncConfirmedAt: null,
    syncMissedAt: null,
    completedAt: null,
    skipped: false,
    anchor: "AUTO",
    anchoredAt: null,
    seriesId: null,
    sessionIndex: null,
    sessionTotal: null,
    externalKey: null,
    scheduleStudyUnitId: null,
    lmsCourseId: null,
    createdAt: new Date("2026-10-01T00:00:00.000Z"),
    updatedAt: new Date("2026-10-01T00:00:00.000Z"),
    tags: [],
    series: null,
    reminders: [],
    ...overrides,
  };
}

function fakePrisma(found: SessionRow | null, occurrenceState: unknown = null) {
  const tx = {
    session: {
      update: jest.fn(({ data }: { data: object }) =>
        Promise.resolve({ ...found, ...data }),
      ),
    },
    sessionEvent: {
      create: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    sessionOccurrenceState: {
      upsert: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  return {
    tx,
    prisma: {
      session: { findFirst: jest.fn().mockResolvedValue(found) },
      sessionOccurrenceState: {
        findUnique: jest.fn().mockResolvedValue(occurrenceState),
      },
      $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
    },
  };
}

/** The first argument of a mock's first call. */
const firstArg = (fn: jest.Mock): unknown => (fn.mock.calls[0] as unknown[])[0];

async function build(prisma: unknown) {
  const module = await Test.createTestingModule({
    providers: [
      SessionCheckOffService,
      { provide: PrismaService, useValue: prisma },
      {
        provide: StreaksService,
        useValue: { refresh: jest.fn().mockResolvedValue(streak) },
      },
    ],
  }).compile();
  return module.get(SessionCheckOffService);
}

describe("nextCheckOffState", () => {
  const done = { completedAt: now, skipped: false };
  const skipped = { completedAt: null, skipped: true };
  const later = new Date(now.getTime() + 1000);

  it("complete clears skip and keeps the first completion time", () => {
    expect(nextCheckOffState(skipped, "complete", true, now)).toEqual(done);
    expect(nextCheckOffState(done, "complete", true, later)).toEqual(done);
  });

  it("skip clears completion", () => {
    expect(nextCheckOffState(done, "skip", true, now)).toEqual(skipped);
  });

  it("undo clears only its own state", () => {
    expect(nextCheckOffState(done, "complete", false, now)).toEqual({
      completedAt: null,
      skipped: false,
    });
    expect(nextCheckOffState(done, "skip", false, now)).toEqual(done);
  });
});

describe("SessionCheckOffService", () => {
  it("completes a row, writes a COMPLETE event and returns the streak", async () => {
    const { prisma, tx } = fakePrisma(row());
    const service = await build(prisma);

    const res = await service.set("s-1", "complete", true, user, now);

    expect(tx.session.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { completedAt: now, skipped: false } }),
    );
    expect(firstArg(tx.sessionEvent.create)).toMatchObject({
      data: { eventType: "COMPLETE", sessionId: "s-1" },
    });
    expect(res.session.completedAt).toBe(now.toISOString());
    expect(res.streak).toBe(streak);
  });

  it("undoing a completion deletes its event and writes none", async () => {
    const { prisma, tx } = fakePrisma(row({ completedAt: now }));
    const service = await build(prisma);

    const res = await service.set("s-1", "complete", false, user, now);

    expect(tx.sessionEvent.deleteMany).toHaveBeenCalledWith({
      where: { sessionId: "s-1", userId: user.id, eventType: "COMPLETE" },
    });
    expect(tx.sessionEvent.create).not.toHaveBeenCalled();
    expect(res.session.completedAt).toBeNull();
  });

  it("skipping a completed row swaps COMPLETE for SKIP", async () => {
    const { prisma, tx } = fakePrisma(row({ completedAt: now }));
    const service = await build(prisma);

    await service.set("s-1", "skip", true, user, now);

    expect(firstArg(tx.sessionEvent.deleteMany)).toMatchObject({
      where: { eventType: "COMPLETE" },
    });
    expect(firstArg(tx.sessionEvent.create)).toMatchObject({
      data: { eventType: "SKIP" },
    });
  });

  it("is idempotent: completing twice writes one event", async () => {
    const { prisma, tx } = fakePrisma(row({ completedAt: now }));
    const service = await build(prisma);

    await service.set("s-1", "complete", true, user, now);

    expect(tx.sessionEvent.create).not.toHaveBeenCalled();
  });

  it("404s a missing row", async () => {
    const { prisma } = fakePrisma(null);
    const service = await build(prisma);

    await expect(
      service.set("nope", "complete", true, user, now),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  describe("recurring occurrence", () => {
    const series: SessionSeries = {
      id: "series-1",
      createdAt: now,
      type: "LECTURE",
      deadline: null,
      rrule: "FREQ=DAILY",
      exdates: ["2026-10-13T07:00:00.000Z"],
      userId: user.id,
    };
    const rep = row({
      id: "rep-1",
      type: "LECTURE",
      deadline: null,
      seriesId: "series-1",
      series,
      scheduledStartTime: new Date("2026-10-01T07:00:00.000Z"),
    });
    const occId = "series-1::2026-10-14T07:00:00.000Z";

    it("records per-occurrence state and keeps the occurrence id", async () => {
      const { prisma, tx } = fakePrisma(rep);
      const service = await build(prisma);

      const res = await service.set(occId, "complete", true, user, now);

      expect(firstArg(tx.sessionOccurrenceState.upsert)).toMatchObject({
        create: {
          seriesId: "series-1",
          occurrenceStart: new Date("2026-10-14T07:00:00.000Z"),
          completedAt: now,
        },
      });
      expect(firstArg(tx.sessionEvent.create)).toMatchObject({
        data: {
          sessionId: "rep-1",
          eventType: "COMPLETE",
          newSnapshot: { scheduledStartTime: "2026-10-14T07:00:00.000Z" },
        },
      });
      expect(res.session).toMatchObject({
        id: occId,
        scheduledStartTime: "2026-10-14T07:00:00.000Z",
        completedAt: now.toISOString(),
        skipped: false,
      });
    });

    it("undo removes the state row and that occurrence's event", async () => {
      const { prisma, tx } = fakePrisma(rep, {
        completedAt: now,
        skipped: false,
      });
      const service = await build(prisma);

      await service.set(occId, "complete", false, user, now);

      expect(tx.sessionOccurrenceState.deleteMany).toHaveBeenCalled();
      expect(firstArg(tx.sessionEvent.deleteMany)).toMatchObject({
        where: {
          sessionId: "rep-1",
          eventType: "COMPLETE",
          newSnapshot: {
            path: ["scheduledStartTime"],
            equals: "2026-10-14T07:00:00.000Z",
          },
        },
      });
    });

    it("404s an occurrence the rule never produces or the user deleted", async () => {
      const { prisma } = fakePrisma(rep);
      const service = await build(prisma);

      await expect(
        service.set("series-1::2026-10-14T08:00:00.000Z", "skip", true, user),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.set("series-1::2026-10-13T07:00:00.000Z", "skip", true, user),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("rejects the representative row id", async () => {
      const { prisma } = fakePrisma(rep);
      const service = await build(prisma);

      await expect(
        service.set("rep-1", "complete", true, user, now),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
