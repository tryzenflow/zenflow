/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call */
import { SeriesPlacer } from "./series-placer.service";

/**
 * `SeriesPlacer` with fake placers + experiment plumbing. The per-slot scoring
 * and day-scan math live in `core/*.spec.ts` / `heuristic-placer.service.spec.ts`;
 * here we prove the D3 wiring — one 50/50 pick per member, the `± floor(X/N)`
 * window, per-member `recordProposal`, sibling accumulation, and that an
 * unplaceable member doesn't block the rest.
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

function makeExperiment(
  policy: "HEURISTIC" | "LINUCB" | ((i: number) => string),
) {
  let call = 0;
  return {
    assignPolicy: jest.fn(() => ({
      primaryPolicy: typeof policy === "function" ? policy(call++) : policy,
      randomizationSeed: "seed",
    })),
    recordProposal: jest.fn().mockResolvedValue(undefined),
  };
}

describe("SeriesPlacer.placeSeries", () => {
  it("places each member via the heuristic and records one proposal per member", async () => {
    const experiment = makeExperiment("HEURISTIC");
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
      experiment as never,
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
    expect(experiment.recordProposal).toHaveBeenCalledTimes(3);
    expect(experiment.assignPolicy).toHaveBeenCalledTimes(3);
  });

  it("routes a LINUCB-assigned member through the bandit placer", async () => {
    const experiment = makeExperiment((i) =>
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
        featureVector: new Array<number>(46).fill(0),
      }),
    };
    const svc = new SeriesPlacer(
      experiment as never,
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
    const linucbProposal = experiment.recordProposal.mock.calls.find(
      (c) => c[0].selectedArm === "NIGHT",
    );
    expect(linucbProposal).toBeTruthy();
  });

  it("clamps each member's window to ± floor(daySpan / count) around its target", async () => {
    const experiment = makeExperiment("HEURISTIC");
    const heuristic = {
      placeInWindow: jest.fn().mockResolvedValue({
        start: new Date("2026-06-10T08:00:00.000Z"),
        score: 1,
      }),
    };
    const bandit = { placeInWindow: jest.fn() };
    const svc = new SeriesPlacer(
      experiment as never,
      heuristic as never,
      bandit as never,
    );

    // 2 members over a ~30-day span → clamp = floor(29/2) = 14. Targets 0 and 29.
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
    expect(firstWindow.firstDayStr).toBe("2026-06-01"); // target 0 − 14 → clamped 0
    expect(firstWindow.lastDayStr).toBe("2026-06-15"); // 0 + 14
    expect(secondWindow.lastDayStr).toBe("2026-06-30"); // target 29 + 14 → clamped 29
  });

  it("feeds each placed sibling forward as an extra hard block", async () => {
    const experiment = makeExperiment("HEURISTIC");
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
      experiment as never,
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
    const experiment = makeExperiment("HEURISTIC");
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
      experiment as never,
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
    expect(experiment.recordProposal).toHaveBeenCalledTimes(3);
  });
});
