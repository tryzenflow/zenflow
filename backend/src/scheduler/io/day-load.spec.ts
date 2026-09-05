import { loadDayLoad } from "./day-load";

/**
 * `loadDayLoad` with an in-memory Prisma double that actually honours the
 * `where` shape (`OR: [{ seriesId: null }, { series: { is: { rrule: null } } }]`
 * on `session.findMany`, `{ rrule: { not: null } }` on `sessionSeries.findMany`)
 * so a regression to the query itself — not just the aggregate output — fails
 * the test. See `heuristic-placer.service.spec.ts` for the sibling pattern.
 *
 * Covers the bug this file used to have: a session belonging to ANY series
 * (a materialized multi-sitting TASK, or a recurring fixed session's
 * representative row) was invisible to the placer scanning a *different*
 * task/series' day, because `others` unconditionally filtered `seriesId: null`
 * and the recurring-expansion loop only ever re-added DND.
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

interface FakeSeries {
  id: string;
  userId: string;
  type: string;
  rrule: string | null;
  rep: { scheduledStartTime: Date; durationMinutes: number } | null;
}

function makeFakePrisma(sessions: FakeSession[], seriesList: FakeSeries[]) {
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
      findMany: jest.fn(
        (args: {
          where: {
            userId: string;
            rrule?: { not: null };
            id?: { not: string };
          };
        }) => {
          const { where } = args;
          const rows = seriesList.filter((s) => {
            if (s.userId !== where.userId) return false;
            if (where.rrule && s.rrule === null) return false;
            if (where.id?.not && s.id === where.id.not) return false;
            return true;
          });
          return Promise.resolve(
            rows.map((s) => ({
              type: s.type,
              rrule: s.rrule,
              sessions: s.rep ? [s.rep] : [],
            })),
          );
        },
      ),
    },
  };
}

describe("loadDayLoad", () => {
  const dayStart = new Date("2026-06-15T00:00:00.000Z");
  const dayEnd = new Date("2026-06-16T00:00:00.000Z");

  it("treats a materialized TASK-series member as occupied on an unrelated placement", async () => {
    const prisma = makeFakePrisma(
      [
        {
          id: "sitting-2",
          userId: "u1",
          seriesId: "task-series-1",
          seriesRrule: null, // TASK series: no rrule
          scheduledStartTime: new Date("2026-06-15T09:00:00.000Z"),
          durationMinutes: 60,
          type: "TASK",
        },
      ],
      [],
    );

    const { occupied, workloadByType } = await loadDayLoad(prisma as never, {
      userId: "u1",
      dayStart,
      dayEnd,
      timezone: TZ,
    });

    expect(occupied).toEqual([
      {
        start: new Date("2026-06-15T09:00:00.000Z").getTime(),
        end: new Date("2026-06-15T10:00:00.000Z").getTime(),
      },
    ]);
    expect(workloadByType.TASK).toEqual({ hours: 1, count: 1 });
  });

  it("respects a non-DND recurring series' occurrence on a non-anchor day", async () => {
    // Anchor: Monday 2026-06-08 10:00 UTC, weekly LECTURE. The day under test
    // (2026-06-15, the following Monday) is a later occurrence, not the
    // representative row's own day.
    const prisma = makeFakePrisma(
      [
        {
          id: "lecture-rep",
          userId: "u1",
          seriesId: "lecture-series-1",
          seriesRrule: "FREQ=WEEKLY;COUNT=5",
          scheduledStartTime: new Date("2026-06-08T10:00:00.000Z"),
          durationMinutes: 90,
          type: "LECTURE",
        },
      ],
      [
        {
          id: "lecture-series-1",
          userId: "u1",
          type: "LECTURE",
          rrule: "FREQ=WEEKLY;COUNT=5",
          rep: {
            scheduledStartTime: new Date("2026-06-08T10:00:00.000Z"),
            durationMinutes: 90,
          },
        },
      ],
    );

    const { occupied, workloadByType } = await loadDayLoad(prisma as never, {
      userId: "u1",
      dayStart,
      dayEnd,
      timezone: TZ,
    });

    expect(occupied).toEqual([
      {
        start: new Date("2026-06-15T10:00:00.000Z").getTime(),
        end: new Date("2026-06-15T11:30:00.000Z").getTime(),
      },
    ]);
    expect(workloadByType.LECTURE).toEqual({ hours: 1.5, count: 1 });
  });

  it("counts a recurring series' anchor-day occurrence exactly once", async () => {
    // Same series, but now scanning its own representative day: the rep row
    // is excluded from the plain-row `others` scan (its series has an rrule)
    // and must be counted only via the expansion loop.
    const anchorDayStart = new Date("2026-06-08T00:00:00.000Z");
    const anchorDayEnd = new Date("2026-06-09T00:00:00.000Z");
    const prisma = makeFakePrisma(
      [
        {
          id: "lecture-rep",
          userId: "u1",
          seriesId: "lecture-series-1",
          seriesRrule: "FREQ=WEEKLY;COUNT=5",
          scheduledStartTime: new Date("2026-06-08T10:00:00.000Z"),
          durationMinutes: 90,
          type: "LECTURE",
        },
      ],
      [
        {
          id: "lecture-series-1",
          userId: "u1",
          type: "LECTURE",
          rrule: "FREQ=WEEKLY;COUNT=5",
          rep: {
            scheduledStartTime: new Date("2026-06-08T10:00:00.000Z"),
            durationMinutes: 90,
          },
        },
      ],
    );

    const { occupied, workloadByType } = await loadDayLoad(prisma as never, {
      userId: "u1",
      dayStart: anchorDayStart,
      dayEnd: anchorDayEnd,
      timezone: TZ,
    });

    expect(occupied).toHaveLength(1);
    expect(occupied[0]).toEqual({
      start: new Date("2026-06-08T10:00:00.000Z").getTime(),
      end: new Date("2026-06-08T11:30:00.000Z").getTime(),
    });
    expect(workloadByType.LECTURE).toEqual({ hours: 1.5, count: 1 });
  });

  it("still counts standalone DND recurrences (legacy behaviour, unchanged)", async () => {
    const prisma = makeFakePrisma(
      [
        {
          id: "dnd-rep",
          userId: "u1",
          seriesId: "dnd-series-1",
          seriesRrule: "FREQ=DAILY",
          scheduledStartTime: new Date("2026-06-14T22:00:00.000Z"),
          durationMinutes: 30,
          type: "DND",
        },
      ],
      [
        {
          id: "dnd-series-1",
          userId: "u1",
          type: "DND",
          rrule: "FREQ=DAILY",
          rep: {
            scheduledStartTime: new Date("2026-06-14T22:00:00.000Z"),
            durationMinutes: 30,
          },
        },
      ],
    );

    const { occupied, workloadByType } = await loadDayLoad(prisma as never, {
      userId: "u1",
      dayStart,
      dayEnd,
      timezone: TZ,
    });

    expect(occupied).toEqual([
      {
        start: new Date("2026-06-15T22:00:00.000Z").getTime(),
        end: new Date("2026-06-15T22:30:00.000Z").getTime(),
      },
    ]);
    expect(workloadByType.DND).toEqual({ hours: 0.5, count: 1 });
  });

  it("excludeSeriesId drops that series from both the plain-row and recurring scans", async () => {
    const prisma = makeFakePrisma(
      [
        {
          id: "sitting-2",
          userId: "u1",
          seriesId: "task-series-1",
          seriesRrule: null,
          scheduledStartTime: new Date("2026-06-15T09:00:00.000Z"),
          durationMinutes: 60,
          type: "TASK",
        },
        {
          id: "lecture-rep",
          userId: "u1",
          seriesId: "lecture-series-1",
          seriesRrule: "FREQ=DAILY",
          scheduledStartTime: new Date("2026-06-08T10:00:00.000Z"),
          durationMinutes: 90,
          type: "LECTURE",
        },
      ],
      [
        {
          id: "lecture-series-1",
          userId: "u1",
          type: "LECTURE",
          rrule: "FREQ=DAILY",
          rep: {
            scheduledStartTime: new Date("2026-06-08T10:00:00.000Z"),
            durationMinutes: 90,
          },
        },
      ],
    );

    const { occupied } = await loadDayLoad(prisma as never, {
      userId: "u1",
      dayStart,
      dayEnd,
      timezone: TZ,
      excludeSeriesId: "lecture-series-1",
    });

    // The materialized TASK sitting (a different series) still counts...
    expect(occupied).toEqual([
      {
        start: new Date("2026-06-15T09:00:00.000Z").getTime(),
        end: new Date("2026-06-15T10:00:00.000Z").getTime(),
      },
    ]);
    // ...but the excluded series' occurrence on this day does not.
    expect(
      occupied.some(
        (o) => o.start === new Date("2026-06-15T10:00:00.000Z").getTime(),
      ),
    ).toBe(false);
  });

  it("defaults excludeSeriesId to a no-op, leaving existing callers unaffected", async () => {
    const prisma = makeFakePrisma(
      [
        {
          id: "sitting-2",
          userId: "u1",
          seriesId: "task-series-1",
          seriesRrule: null,
          scheduledStartTime: new Date("2026-06-15T09:00:00.000Z"),
          durationMinutes: 60,
          type: "TASK",
        },
      ],
      [],
    );

    const { occupied } = await loadDayLoad(prisma as never, {
      userId: "u1",
      dayStart,
      dayEnd,
      timezone: TZ,
    });

    expect(occupied).toHaveLength(1);
  });
});
