import { HeuristicPlacer } from "./heuristic-placer.service";

/**
 * `HeuristicPlacer` with an in-memory-ish Prisma double. The pure scoring math
 * is covered by `core/slot-score.spec.ts`; here we exercise the day scan and
 * the single global-best pick. Series placement lives in
 * `series-placer.service.spec.ts`.
 *
 * An empty `preferenceMatrix` falls back to the cold-start default (weekday
 * 08–11h → 1), so the best slot on any day is 08:00 local.
 */

const TZ = "UTC";
const MATRIX: number[] = [];

function makePrisma(
  occupied: { start: string; durationMinutes: number }[] = [],
) {
  return {
    session: {
      findMany: jest.fn().mockResolvedValue(
        occupied.map((o) => ({
          scheduledStartTime: new Date(o.start),
          durationMinutes: o.durationMinutes,
          type: "ASSIGNMENT",
        })),
      ),
    },
    sessionSeries: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

/**
 * Like {@link makePrisma} but honours the `scheduledStartTime` gte/lte range in
 * the query — needed to exercise cross-midnight placement, where a day scan
 * loads a widened window (a day back for spill-over, plus a lookahead sliver).
 */
function makeRangeAwarePrisma(
  occupied: { start: string; durationMinutes: number }[] = [],
) {
  const rows = occupied.map((o) => ({
    scheduledStartTime: new Date(o.start),
    durationMinutes: o.durationMinutes,
    type: "ASSIGNMENT" as const,
  }));
  return {
    session: {
      findMany: jest.fn(
        (args?: {
          where?: { scheduledStartTime?: { gte?: Date; lte?: Date } };
        }) => {
          const gte =
            args?.where?.scheduledStartTime?.gte?.getTime() ?? -Infinity;
          const lte =
            args?.where?.scheduledStartTime?.lte?.getTime() ?? Infinity;
          return Promise.resolve(
            rows.filter((r) => {
              const t = r.scheduledStartTime.getTime();
              return t >= gte && t <= lte;
            }),
          );
        },
      ),
    },
    sessionSeries: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

describe("HeuristicPlacer.scheduleTask", () => {
  const now = new Date("2026-06-15T00:00:00.000Z");
  const task = {
    id: "t1",
    durationMinutes: 60,
    deadline: new Date("2026-06-18T00:00:00.000Z"),
  };

  it("places an empty-calendar task at the earliest highest-preference slot", async () => {
    const svc = new HeuristicPlacer(makePrisma() as never);
    const start = await svc.placeTask("u1", task, TZ, MATRIX, now);
    expect(start?.toISOString()).toBe("2026-06-15T08:00:00.000Z");
  });

  it("returns null when the only candidate day is fully occupied", async () => {
    const svc = new HeuristicPlacer(
      makePrisma([
        { start: "2026-06-15T00:00:00.000Z", durationMinutes: 1440 },
      ]) as never,
    );
    const sameDay = {
      id: "t1",
      durationMinutes: 60,
      deadline: new Date("2026-06-16T00:00:00.000Z"),
    };
    expect(await svc.placeTask("u1", sameDay, TZ, MATRIX, now)).toBeNull();
  });

  it("returns null when the duration cannot fit before the deadline", async () => {
    const svc = new HeuristicPlacer(makePrisma() as never);
    const tight = {
      id: "t1",
      durationMinutes: 60,
      deadline: new Date("2026-06-15T00:30:00.000Z"),
    };
    expect(await svc.placeTask("u1", tight, TZ, MATRIX, now)).toBeNull();
  });

  it("schedules around an existing session without moving it", async () => {
    const svc = new HeuristicPlacer(
      makePrisma([
        { start: "2026-06-15T08:00:00.000Z", durationMinutes: 60 },
      ]) as never,
    );
    const start = await svc.placeTask("u1", task, TZ, MATRIX, now);
    // 08:00 is taken; 09:00 (still a preference-1 bucket) is the next best.
    expect(start?.toISOString()).toBe("2026-06-15T09:00:00.000Z");
  });

  it("places a task straddling midnight when that is the only room before a small-hours deadline", async () => {
    // Monday is booked solid until 23:00; the deadline is 01:00 Tuesday, so the
    // only 90-minute slot anywhere is 23:00 Mon → 00:30 Tue.
    const svc = new HeuristicPlacer(
      makeRangeAwarePrisma([
        { start: "2026-06-15T00:00:00.000Z", durationMinutes: 1380 }, // 00:00–23:00
      ]) as never,
    );
    const straddler = {
      id: "t1",
      durationMinutes: 90,
      deadline: new Date("2026-06-16T01:00:00.000Z"),
    };
    const start = await svc.placeTask("u1", straddler, TZ, MATRIX, now);
    expect(start?.toISOString()).toBe("2026-06-15T23:00:00.000Z");
  });

  it("will not straddle midnight into a block already on the next morning", async () => {
    // Same Monday fill, but now 00:00–01:00 Tuesday is taken too — the 23:00
    // straddle would overlap it, and nothing else fits before the 01:00 deadline.
    const svc = new HeuristicPlacer(
      makeRangeAwarePrisma([
        { start: "2026-06-15T00:00:00.000Z", durationMinutes: 1380 },
        { start: "2026-06-16T00:00:00.000Z", durationMinutes: 60 },
      ]) as never,
    );
    const straddler = {
      id: "t1",
      durationMinutes: 90,
      deadline: new Date("2026-06-16T01:00:00.000Z"),
    };
    expect(await svc.placeTask("u1", straddler, TZ, MATRIX, now)).toBeNull();
  });
});
