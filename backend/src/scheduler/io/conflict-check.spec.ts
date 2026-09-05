import { wouldConflict } from "./conflict-check";

/**
 * `wouldConflict` is a thin composition of `periodRange` (day bounds) +
 * `loadDayLoad` (occupancy) + `overlapsAny` (the check itself) — these tests
 * exercise that composition with the same in-memory Prisma double style as
 * `day-load.spec.ts`, rather than re-deriving `loadDayLoad`'s own coverage.
 */

const TZ = "UTC";

interface FakeSession {
  id: string;
  userId: string;
  seriesId: string | null;
  seriesRrule: string | null;
  scheduledStartTime: Date;
  durationMinutes: number;
  type: string;
}

function makeFakePrisma(sessions: FakeSession[]) {
  return {
    session: {
      findMany: jest.fn(
        (args: {
          where: {
            userId: string;
            id?: { notIn: string[] };
            NOT?: { seriesId: string };
            OR?: Array<
              { seriesId: null } | { series: { is: { rrule: null } } }
            >;
            scheduledStartTime?: { gte?: Date; lte?: Date };
          };
        }) => {
          const { where } = args;
          const rows = sessions.filter((s) => {
            if (s.userId !== where.userId) return false;
            if (where.id?.notIn.includes(s.id)) return false;
            if (where.NOT && s.seriesId === where.NOT.seriesId) return false;
            if (where.OR) {
              const matches = where.OR.some((cond) => {
                if ("seriesId" in cond) return s.seriesId === cond.seriesId;
                return s.seriesRrule === cond.series.is.rrule;
              });
              if (!matches) return false;
            }
            const t = s.scheduledStartTime.getTime();
            if (
              where.scheduledStartTime?.gte &&
              t < where.scheduledStartTime.gte.getTime()
            )
              return false;
            if (
              where.scheduledStartTime?.lte &&
              t > where.scheduledStartTime.lte.getTime()
            )
              return false;
            return true;
          });
          return Promise.resolve(
            rows.map((r) => ({
              scheduledStartTime: r.scheduledStartTime,
              durationMinutes: r.durationMinutes,
              type: r.type,
            })),
          );
        },
      ),
    },
    sessionSeries: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
}

describe("wouldConflict", () => {
  it("returns true when the candidate landing overlaps an existing session", async () => {
    const prisma = makeFakePrisma([
      {
        id: "existing-1",
        userId: "u1",
        seriesId: null,
        seriesRrule: null,
        scheduledStartTime: new Date("2026-06-15T09:00:00.000Z"),
        durationMinutes: 60,
        type: "TASK",
      },
    ]);

    const result = await wouldConflict(prisma as never, {
      userId: "u1",
      timezone: TZ,
      start: new Date("2026-06-15T09:30:00.000Z"),
      durationMinutes: 30,
    });

    expect(result).toBe(true);
  });

  it("returns false when the candidate landing is free", async () => {
    const prisma = makeFakePrisma([
      {
        id: "existing-1",
        userId: "u1",
        seriesId: null,
        seriesRrule: null,
        scheduledStartTime: new Date("2026-06-15T09:00:00.000Z"),
        durationMinutes: 60,
        type: "TASK",
      },
    ]);

    const result = await wouldConflict(prisma as never, {
      userId: "u1",
      timezone: TZ,
      start: new Date("2026-06-15T10:00:00.000Z"),
      durationMinutes: 30,
    });

    expect(result).toBe(false);
  });

  it("excludeSessionIds keeps a session from conflicting with itself", async () => {
    const prisma = makeFakePrisma([
      {
        id: "self-1",
        userId: "u1",
        seriesId: null,
        seriesRrule: null,
        scheduledStartTime: new Date("2026-06-15T09:00:00.000Z"),
        durationMinutes: 60,
        type: "TASK",
      },
    ]);

    const result = await wouldConflict(prisma as never, {
      userId: "u1",
      timezone: TZ,
      start: new Date("2026-06-15T09:00:00.000Z"),
      durationMinutes: 60,
      excludeSessionIds: ["self-1"],
    });

    expect(result).toBe(false);
  });

  it("excludeSeriesId keeps a series' own materialized member from conflicting with a new landing", async () => {
    const prisma = makeFakePrisma([
      {
        id: "sitting-2",
        userId: "u1",
        seriesId: "task-series-1",
        seriesRrule: null,
        scheduledStartTime: new Date("2026-06-15T09:00:00.000Z"),
        durationMinutes: 60,
        type: "TASK",
      },
    ]);

    const result = await wouldConflict(prisma as never, {
      userId: "u1",
      timezone: TZ,
      start: new Date("2026-06-15T09:00:00.000Z"),
      durationMinutes: 60,
      excludeSeriesId: "task-series-1",
    });

    expect(result).toBe(false);
  });

  it("sees a post-midnight block via the overhang lookahead for a late-starting candidate", async () => {
    const prisma = makeFakePrisma([
      {
        id: "next-morning-1",
        userId: "u1",
        seriesId: null,
        seriesRrule: null,
        scheduledStartTime: new Date("2026-06-16T00:30:00.000Z"),
        durationMinutes: 60,
        type: "TASK",
      },
    ]);

    // Starts 23:00 on the 15th, runs 2h — overlaps the 00:30 block the next morning.
    const result = await wouldConflict(prisma as never, {
      userId: "u1",
      timezone: TZ,
      start: new Date("2026-06-15T23:00:00.000Z"),
      durationMinutes: 120,
    });

    expect(result).toBe(true);
  });
});
