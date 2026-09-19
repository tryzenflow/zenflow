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
// 30 days to the deadline.
const DEADLINE = new Date("2026-07-01T00:00:00.000Z");

function members(n: number, durationMinutes = 60) {
  return Array.from({ length: n }, (_, i) => ({
    id: `m${i + 1}`,
    durationMinutes,
  }));
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

  it("routes a LINUCB-assigned member through the bandit placer", async () => {
    const coordinator = makeCoordinator((i) =>
      i === 1 ? "LINUCB" : "HEURISTIC",
    );
    const heuristic = {
      placeInWindow: jest.fn().mockResolvedValue({
        start: new Date("2026-06-10T08:00:00.000Z"),
        score: 1,
      }),
    };
    const bandit = {
      placeInWindow: jest.fn().mockResolvedValue({
        scheduledStartTime: new Date("2026-06-16T20:00:00.000Z"),
        selectedArm: "NIGHT",
        featureVector: new Array<number>(22).fill(0),
      }),
    };
    const svc = new SeriesPlacer(
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

    expect(bandit.placeInWindow).toHaveBeenCalledTimes(1);
    // Member 2 (index 1) took the bandit pick.
    expect(rows[1].scheduledStartTime?.toISOString()).toBe(
      "2026-06-16T20:00:00.000Z",
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

  it("feeds each placed sibling forward as an extra hard block", async () => {
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
      coordinator as never,
      heuristic as never,
      bandit as never,
    );

    await svc.placeSeries(
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
    expect(secondOpts.extraOccupied).toHaveLength(1);
    expect(secondOpts.extraOccupied[0].start).toBe(starts[0].getTime());
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
