/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call */
import { SeriesPlacer } from "./series-placer.service";

/**
 * `SeriesPlacer` with fake placers + a fake `SchedulingExperimentCoordinator`.
 * The per-slot scoring and day-scan math live in `core/*.spec.ts` /
 * `heuristic-placer.service.spec.ts` (the non-overlapping day-window
 * partition itself is `series-spread.spec.ts`); the A/B assignment + bandit
 * routing itself is `scheduling-experiment-coordinator.service.spec.ts`.
 * Here we prove the wiring — one coordinator run per member, each member's
 * window from `seriesDayWindows`, sibling accumulation, that an unplaceable
 * member doesn't block the rest, and that a dry run skips the coordinator
 * entirely.
 */

const TZ = "UTC";
const MATRIX: number[] = [];
const NOW = new Date("2026-06-01T00:00:00.000Z");
// 30 days to the deadline — count <= daySpan + 1 for every series below (3
// or fewer members), so these all take the DISJOINT (concurrent) path
// unless a test explicitly forces a short deadline for the dense path.
const DEADLINE = new Date("2026-07-01T00:00:00.000Z");

function members(n: number, durationMinutes = 60) {
  return Array.from({ length: n }, (_, i) => ({
    id: `m${i + 1}`,
    durationMinutes,
  }));
}

/** Empty-calendar Prisma double for `SeriesPlacer`'s own union day-load
 * read (`loadScheduleItems` in `day-load.ts`) — every test below exercises
 * the heuristic/bandit *placer* mocks, not real occupancy, so the union
 * query itself should just come back empty. */
function makePrisma() {
  return {
    session: { findMany: jest.fn().mockResolvedValue([]) },
    sessionSeries: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

/** A fake coordinator: `policy` decides (per call, 0-indexed) whether the
 * member is routed to the bandit; when it is, `input.runBandit()` is
 * actually invoked so bandit-wiring assertions still work. */
function makeCoordinator(
  policy: "HEURISTIC" | "LINUCB" | ((i: number) => "HEURISTIC" | "LINUCB"),
) {
  let call = 0;
  const run = jest.fn(
    async (input: {
      heuristicStart: Date | null;
      runBandit: () => Promise<{
        scheduledStartTime: Date;
        selectedArm: string;
        featureVector: number[];
      } | null>;
    }) => {
      const primaryPolicy =
        typeof policy === "function" ? policy(call++) : policy;
      const banditPick =
        primaryPolicy === "LINUCB" ? await input.runBandit() : null;
      return {
        appliedStart: banditPick
          ? banditPick.scheduledStartTime
          : input.heuristicStart,
        appliedPolicy: banditPick
          ? "LINUCB"
          : input.heuristicStart
            ? "HEURISTIC"
            : "NONE",
        assignedPolicy: primaryPolicy,
        banditAttempted: primaryPolicy === "LINUCB",
        banditPick,
        slotProposalId: null,
        alternativeSlot: null,
        divergent: false,
      };
    },
  );
  return { run };
}

describe("SeriesPlacer.placeSeries", () => {
  it("places each member via the heuristic and runs the coordinator once per member", async () => {
    const coordinator = makeCoordinator("HEURISTIC");
    const heuristic = {
      placeInWindow: jest.fn((_u: unknown, task: { id: string }) =>
        Promise.resolve({
          start: new Date(`2026-06-1${task.id.slice(1)}T08:00:00.000Z`),
          score: 1,
        }),
      ),
    };
    const bandit = { placeInWindow: jest.fn() };
    const svc = new SeriesPlacer(
      makePrisma() as never,
      coordinator as never,
      heuristic as never,
      bandit as never,
    );

    const rows = await svc.placeSeries(
      "u1",
      { members: members(3), deadline: DEADLINE },
      TZ,
      MATRIX,
      NOW,
      { trigger: "create" },
    );

    expect(rows.map((r) => r.scheduledStartTime !== null)).toEqual([
      true,
      true,
      true,
    ]);
    expect(bandit.placeInWindow).not.toHaveBeenCalled();
    expect(coordinator.run).toHaveBeenCalledTimes(3);
  });

  it("dense case: routes a LINUCB-assigned member through the per-member bandit placer", async () => {
    // 3 members, deadline the same day (daySpan=0) → dense → the exact
    // unchanged sequential loop, still one bandit.placeInWindow call per
    // LINUCB-assigned member (not the batched Tier 1 path).
    const denseDeadline = new Date("2026-06-01T20:00:00.000Z");
    const coordinator = makeCoordinator((i) =>
      i === 1 ? "LINUCB" : "HEURISTIC",
    );
    const heuristic = {
      placeInWindow: jest.fn().mockResolvedValue({
        start: new Date("2026-06-01T08:00:00.000Z"),
        score: 1,
      }),
    };
    const bandit = {
      placeInWindow: jest.fn().mockResolvedValue({
        scheduledStartTime: new Date("2026-06-01T16:00:00.000Z"),
        selectedArm: "NIGHT",
        featureVector: new Array<number>(22).fill(0),
      }),
      placeSeriesMembers: jest.fn(),
    };
    const svc = new SeriesPlacer(
      makePrisma() as never,
      coordinator as never,
      heuristic as never,
      bandit as never,
    );

    const rows = await svc.placeSeries(
      "u1",
      { members: members(3), deadline: denseDeadline },
      TZ,
      MATRIX,
      NOW,
      { trigger: "create" },
    );

    expect(bandit.placeInWindow).toHaveBeenCalledTimes(1);
    expect(bandit.placeSeriesMembers).not.toHaveBeenCalled();
    // Member 2 (index 1) took the bandit pick.
    expect(rows[1].scheduledStartTime?.toISOString()).toBe(
      "2026-06-01T16:00:00.000Z",
    );
  });

  it("gives each member its own non-overlapping day-window (seriesDayWindows)", async () => {
    const coordinator = makeCoordinator("HEURISTIC");
    const heuristic = {
      placeInWindow: jest.fn().mockResolvedValue({
        start: new Date("2026-06-10T08:00:00.000Z"),
        score: 1,
      }),
    };
    const bandit = { placeInWindow: jest.fn() };
    const svc = new SeriesPlacer(
      makePrisma() as never,
      coordinator as never,
      heuristic as never,
      bandit as never,
    );

    // 31 days (span=30), 2 members → seriesDayWindows(30, 2) = [[0,14],[15,30]].
    await svc.placeSeries(
      "u1",
      { members: members(2), deadline: DEADLINE },
      TZ,
      MATRIX,
      NOW,
      { trigger: "create" },
    );

    const [firstWindow] = heuristic.placeInWindow.mock.calls[0].slice(5, 6);
    const [secondWindow] = heuristic.placeInWindow.mock.calls[1].slice(5, 6);
    expect(firstWindow).toEqual({
      firstDayStr: "2026-06-01",
      lastDayStr: "2026-06-15",
    });
    // Starts the day right after the first window ends — no overlap.
    expect(secondWindow).toEqual({
      firstDayStr: "2026-06-16",
      lastDayStr: "2026-07-01",
    });
  });

  it("dense case: feeds each placed sibling forward sequentially (unchanged loop)", async () => {
    // 2 members, deadline the same day (daySpan=0) → count(2) > daySpan+1(1)
    // → dense, so seriesWindowsAreDisjoint is false and placeSeries keeps
    // the strictly sequential loop, where recordSibling runs between
    // members (not deferred).
    const denseDeadline = new Date("2026-06-01T20:00:00.000Z");
    const coordinator = makeCoordinator("HEURISTIC");
    const starts = [
      new Date("2026-06-01T08:00:00.000Z"),
      new Date("2026-06-01T12:00:00.000Z"),
    ];
    const heuristic = {
      placeInWindow: jest.fn(() => {
        const call = heuristic.placeInWindow.mock.calls.length - 1;
        return Promise.resolve({ start: starts[call], score: 1 });
      }),
    };
    const bandit = { placeInWindow: jest.fn() };
    const svc = new SeriesPlacer(
      makePrisma() as never,
      coordinator as never,
      heuristic as never,
      bandit as never,
    );

    await svc.placeSeries(
      "u1",
      { members: members(2), deadline: denseDeadline },
      TZ,
      MATRIX,
      NOW,
      { trigger: "create" },
    );

    const firstOpts = heuristic.placeInWindow.mock.calls[0][6];
    const secondOpts = heuristic.placeInWindow.mock.calls[1][6];
    expect(firstOpts.extraOccupied).toHaveLength(0);
    expect(secondOpts.extraOccupied).toHaveLength(1);
    expect(secondOpts.extraOccupied[0].start).toBe(starts[0].getTime());
  });

  it("disjoint case: sibling bookkeeping is deferred — no member sees an earlier member's placement as extraOccupied", async () => {
    // Both members' windows are disjoint (2 members, 30-day span), so
    // recordSibling is deferred to after Promise.all resolves — neither
    // member's heuristic call can see the other's placement, unlike the
    // dense case above.
    const coordinator = makeCoordinator("HEURISTIC");
    const starts = [
      new Date("2026-06-05T08:00:00.000Z"),
      new Date("2026-06-15T08:00:00.000Z"),
    ];
    const heuristic = {
      placeInWindow: jest.fn(() => {
        const call = heuristic.placeInWindow.mock.calls.length - 1;
        return Promise.resolve({ start: starts[call], score: 1 });
      }),
    };
    const bandit = { placeInWindow: jest.fn() };
    const svc = new SeriesPlacer(
      makePrisma() as never,
      coordinator as never,
      heuristic as never,
      bandit as never,
    );

    const rows = await svc.placeSeries(
      "u1",
      { members: members(2), deadline: DEADLINE },
      TZ,
      MATRIX,
      NOW,
      { trigger: "create" },
    );

    const firstOpts = heuristic.placeInWindow.mock.calls[0][6];
    const secondOpts = heuristic.placeInWindow.mock.calls[1][6];
    expect(firstOpts.extraOccupied).toHaveLength(0);
    expect(secondOpts.extraOccupied).toHaveLength(0);
    // Both still end up placed in the returned rows.
    expect(rows.map((r) => r.scheduledStartTime?.toISOString())).toEqual(
      starts.map((s) => s.toISOString()),
    );
  });

  it("issues exactly one union day-load query regardless of member count", async () => {
    const coordinator = makeCoordinator("HEURISTIC");
    const heuristic = {
      placeInWindow: jest.fn().mockResolvedValue({
        start: new Date("2026-06-10T08:00:00.000Z"),
        score: 1,
      }),
    };
    const bandit = { placeInWindow: jest.fn() };
    const prisma = makePrisma();
    const svc = new SeriesPlacer(
      prisma as never,
      coordinator as never,
      heuristic as never,
      bandit as never,
    );

    await svc.placeSeries(
      "u1",
      { members: members(5), deadline: DEADLINE },
      TZ,
      MATRIX,
      NOW,
      { trigger: "create" },
    );

    expect(prisma.session.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.sessionSeries.findMany).toHaveBeenCalledTimes(1);
  });

  it("disjoint LINUCB members share one batched bandit call instead of one per member", async () => {
    const coordinator = makeCoordinator("LINUCB");
    const heuristic = {
      placeInWindow: jest.fn().mockResolvedValue({
        start: new Date("2026-06-10T08:00:00.000Z"),
        score: 1,
      }),
    };
    const bandit = {
      placeInWindow: jest.fn(),
      placeSeriesMembers: jest.fn().mockResolvedValue(
        new Map([
          [
            "m1",
            {
              scheduledStartTime: new Date("2026-06-06T20:00:00.000Z"),
              selectedArm: "NIGHT",
              featureVector: new Array<number>(22).fill(0),
              weights: { wL: 1, wP: 0.1 },
            },
          ],
          [
            "m2",
            {
              scheduledStartTime: new Date("2026-06-20T20:00:00.000Z"),
              selectedArm: "NIGHT",
              featureVector: new Array<number>(22).fill(0),
              weights: { wL: 1, wP: 0.1 },
            },
          ],
        ]),
      ),
    };
    const svc = new SeriesPlacer(
      makePrisma() as never,
      coordinator as never,
      heuristic as never,
      bandit as never,
    );

    const rows = await svc.placeSeries(
      "u1",
      { members: members(2), deadline: DEADLINE },
      TZ,
      MATRIX,
      NOW,
      { trigger: "create" },
    );

    expect(bandit.placeInWindow).not.toHaveBeenCalled();
    expect(bandit.placeSeriesMembers).toHaveBeenCalledTimes(1);
    expect(rows[0].scheduledStartTime?.toISOString()).toBe(
      "2026-06-06T20:00:00.000Z",
    );
    expect(rows[1].scheduledStartTime?.toISOString()).toBe(
      "2026-06-20T20:00:00.000Z",
    );
  });

  it("leaves an unplaceable member null without blocking the others", async () => {
    const coordinator = makeCoordinator("HEURISTIC");
    const heuristic = {
      placeInWindow: jest.fn(() => {
        const call = heuristic.placeInWindow.mock.calls.length - 1;
        return Promise.resolve(
          call === 1
            ? null
            : { start: new Date("2026-06-10T08:00:00.000Z"), score: 1 },
        );
      }),
    };
    const bandit = { placeInWindow: jest.fn() };
    const svc = new SeriesPlacer(
      makePrisma() as never,
      coordinator as never,
      heuristic as never,
      bandit as never,
    );

    const rows = await svc.placeSeries(
      "u1",
      { members: members(3), deadline: DEADLINE },
      TZ,
      MATRIX,
      NOW,
      { trigger: "create" },
    );

    expect(rows.map((r) => r.scheduledStartTime !== null)).toEqual([
      true,
      false,
      true,
    ]);
    expect(coordinator.run).toHaveBeenCalledTimes(3);
  });

  it("dryRun places via the heuristic only, and never calls the coordinator", async () => {
    const coordinator = makeCoordinator("LINUCB"); // would route to the bandit if not for dryRun
    const heuristic = {
      placeInWindow: jest.fn().mockResolvedValue({
        start: new Date("2026-06-10T08:00:00.000Z"),
        score: 1,
      }),
    };
    const bandit = { placeInWindow: jest.fn() };
    const svc = new SeriesPlacer(
      makePrisma() as never,
      coordinator as never,
      heuristic as never,
      bandit as never,
    );

    const rows = await svc.placeSeries(
      "u1",
      { members: members(3), deadline: DEADLINE },
      TZ,
      MATRIX,
      NOW,
      { trigger: "create", dryRun: true },
    );

    expect(rows.map((r) => r.scheduledStartTime !== null)).toEqual([
      true,
      true,
      true,
    ]);
    expect(bandit.placeInWindow).not.toHaveBeenCalled();
    expect(coordinator.run).not.toHaveBeenCalled();
  });
});
