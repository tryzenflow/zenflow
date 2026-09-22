import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { TagsService } from "../tags/tags.service";
import { TaskPlacementService } from "../scheduler/io/task-placement.service";
import { SessionCrudService } from "./session-crud.service";
import { SeriesService } from "./series.service";
import type { User } from "../../generated/prisma";

/**
 * Focused coverage for the timetable-group delete pair
 * (`removeTimetableGroupFrom` / `removeTimetableGroup`) — the three-way
 * delete choice for a portal-ingested `LECTURE`, grouped by
 * `Session.scheduleStudyUnitId` since these rows have no `SessionSeries`.
 * Exercised directly against a hand-rolled `PrismaService` double, mirroring
 * `series.service.spec.ts`'s style.
 */

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

async function makeService(prisma: unknown): Promise<SessionCrudService> {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      SessionCrudService,
      { provide: PrismaService, useValue: prisma },
      { provide: TagsService, useValue: { resolveTagIds: jest.fn() } },
      {
        provide: TaskPlacementService,
        useValue: { preflightTask: jest.fn(), canPlaceSeries: jest.fn() },
      },
      { provide: SeriesService, useValue: {} },
    ],
  }).compile();
  return module.get<SessionCrudService>(SessionCrudService);
}

interface FakeRow {
  id: string;
  userId: string;
  deleted: boolean;
  scheduleStudyUnitId: string | null;
  scheduledStartTime: Date | null;
}

function buildPrisma(rows: FakeRow[]) {
  const findFirst = jest.fn(
    (args: {
      where: {
        id: string;
        userId: string;
        deleted: boolean;
        scheduleStudyUnitId?: { not: null };
      };
    }) => {
      const row = rows.find(
        (r) =>
          r.id === args.where.id &&
          r.userId === args.where.userId &&
          r.deleted === args.where.deleted &&
          (!args.where.scheduleStudyUnitId || r.scheduleStudyUnitId !== null),
      );
      return Promise.resolve(row ?? null);
    },
  );
  const findMany = jest.fn(
    (args: {
      where: {
        userId: string;
        deleted: boolean;
        scheduleStudyUnitId: string | null;
        scheduledStartTime?: { gte?: Date };
      };
    }) => {
      const matched = rows.filter(
        (r) =>
          r.userId === args.where.userId &&
          r.deleted === args.where.deleted &&
          r.scheduleStudyUnitId === args.where.scheduleStudyUnitId &&
          (!args.where.scheduledStartTime?.gte ||
            (r.scheduledStartTime &&
              r.scheduledStartTime.getTime() >=
                args.where.scheduledStartTime.gte.getTime())),
      );
      return Promise.resolve(matched);
    },
  );
  const updateMany = jest.fn().mockResolvedValue({ count: 0 });
  return {
    session: { findFirst, findMany, updateMany },
  };
}

function row(overrides: Partial<FakeRow> & { id: string }): FakeRow {
  return {
    userId: user.id,
    deleted: false,
    scheduleStudyUnitId: null,
    scheduledStartTime: null,
    ...overrides,
  };
}

describe("SessionCrudService.removeTimetableGroupFrom", () => {
  it("soft-deletes the anchor and every later meeting in the same section, leaves earlier ones and other sections untouched", async () => {
    const rows = [
      row({
        id: "m-1",
        scheduleStudyUnitId: "SEC-A",
        scheduledStartTime: new Date("2026-06-01T08:00:00.000Z"),
      }),
      row({
        id: "m-2",
        scheduleStudyUnitId: "SEC-A",
        scheduledStartTime: new Date("2026-06-08T08:00:00.000Z"),
      }),
      row({
        id: "m-3",
        scheduleStudyUnitId: "SEC-A",
        scheduledStartTime: new Date("2026-06-15T08:00:00.000Z"),
      }),
      // Different section — never touched.
      row({
        id: "other-1",
        scheduleStudyUnitId: "SEC-B",
        scheduledStartTime: new Date("2026-06-08T08:00:00.000Z"),
      }),
    ];
    const prisma = buildPrisma(rows);
    const service = await makeService(prisma);

    const result = await service.removeTimetableGroupFrom("m-2", user);

    expect(result.removedSessionIds.sort()).toEqual(["m-2", "m-3"]);
    expect(prisma.session.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["m-2", "m-3"] }, userId: user.id },
      data: { deleted: true },
    });
  });

  it("throws NotFoundException for another user's session", async () => {
    const rows = [
      row({
        id: "m-1",
        userId: "someone-else",
        scheduleStudyUnitId: "SEC-A",
        scheduledStartTime: new Date("2026-06-01T08:00:00.000Z"),
      }),
    ];
    const service = await makeService(buildPrisma(rows));

    await expect(
      service.removeTimetableGroupFrom("m-1", user),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("throws NotFoundException for a session with no scheduleStudyUnitId", async () => {
    const rows = [
      row({
        id: "m-1",
        scheduleStudyUnitId: null,
        scheduledStartTime: new Date("2026-06-01T08:00:00.000Z"),
      }),
    ];
    const service = await makeService(buildPrisma(rows));

    await expect(
      service.removeTimetableGroupFrom("m-1", user),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("SessionCrudService.removeTimetableGroup", () => {
  it("soft-deletes the whole section regardless of time, leaves other sections untouched", async () => {
    const rows = [
      row({
        id: "m-1",
        scheduleStudyUnitId: "SEC-A",
        scheduledStartTime: new Date("2026-06-01T08:00:00.000Z"),
      }),
      row({
        id: "m-2",
        scheduleStudyUnitId: "SEC-A",
        scheduledStartTime: new Date("2026-06-08T08:00:00.000Z"),
      }),
      row({
        id: "other-1",
        scheduleStudyUnitId: "SEC-B",
        scheduledStartTime: new Date("2026-06-08T08:00:00.000Z"),
      }),
    ];
    const prisma = buildPrisma(rows);
    const service = await makeService(prisma);

    // Anchor on the LATER meeting — the whole-group route ignores time, so
    // the earlier meeting must still come back removed too.
    const result = await service.removeTimetableGroup("m-2", user);

    expect(result.removedSessionIds.sort()).toEqual(["m-1", "m-2"]);
    expect(prisma.session.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["m-1", "m-2"] }, userId: user.id },
      data: { deleted: true },
    });
  });

  it("throws NotFoundException for another user's session", async () => {
    const rows = [
      row({
        id: "m-1",
        userId: "someone-else",
        scheduleStudyUnitId: "SEC-A",
      }),
    ];
    const service = await makeService(buildPrisma(rows));

    await expect(
      service.removeTimetableGroup("m-1", user),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("throws NotFoundException for a session with no scheduleStudyUnitId", async () => {
    const rows = [row({ id: "m-1", scheduleStudyUnitId: null })];
    const service = await makeService(buildPrisma(rows));

    await expect(
      service.removeTimetableGroup("m-1", user),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
