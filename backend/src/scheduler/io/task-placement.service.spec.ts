/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { TaskPlacementService } from "./task-placement.service";

/**
 * `TaskPlacementService.placeOnCreate` / `placeOnDeadlineChange` — the single-TASK
 * A/B facade. Absorbs what `sessions.service.spec.ts` used to assert about
 * `runSchedulingExperiment`. Series placement is covered by
 * `series-placer.service.spec.ts`.
 */

const user = {
  id: "u1",
  timezone: "UTC",
  preferenceMatrix: [] as number[],
} as never;
const task = {
  id: "t1",
  durationMinutes: 60,
  deadline: new Date("2026-06-10T00:00:00.000Z"),
};
const now = new Date("2026-06-08T00:00:00.000Z");

function makeDeps(over: {
  heuristicStart?: Date | null;
  policy?: "HEURISTIC" | "LINUCB";
  pick?: unknown;
  banditThrows?: boolean;
}) {
  const sessionUpdate = jest.fn().mockResolvedValue({});
  const prisma = { session: { update: sessionUpdate } };
  const experiment = {
    assignPolicy: jest.fn(() => ({
      primaryPolicy: over.policy ?? "HEURISTIC",
      randomizationSeed: "seed",
    })),
    recordProposal: jest.fn().mockResolvedValue(undefined),
  };
  const heuristic = {
    placeTask: jest
      .fn()
      .mockResolvedValue(
        over.heuristicStart === undefined ? null : over.heuristicStart,
      ),
  };
  const bandit = {
    placeTask: over.banditThrows
      ? jest.fn().mockRejectedValue(new Error("bandit down"))
      : jest.fn().mockResolvedValue(over.pick ?? null),
  };
  const svc = new TaskPlacementService(
    prisma as never,
    experiment as never,
    heuristic as never,
    bandit as never,
    { placeSeries: jest.fn() } as never,
  );
  return { svc, sessionUpdate, experiment, heuristic, bandit };
}

describe("TaskPlacementService.placeOnCreate", () => {
  it("keeps the heuristic placement and records a proposal when HEURISTIC is primary", async () => {
    const slot = new Date("2026-06-09T09:00:00.000Z");
    const { svc, sessionUpdate, experiment, bandit } = makeDeps({
      heuristicStart: slot,
      policy: "HEURISTIC",
    });

    const res = await svc.placeOnCreate({ user, task, now });

    expect(res).toEqual({
      scheduledStartTime: slot,
      appliedPolicy: "HEURISTIC",
    });
    expect(sessionUpdate).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: { scheduledStartTime: slot },
    });
    expect(bandit.placeTask).not.toHaveBeenCalled();
    expect(experiment.recordProposal).toHaveBeenCalledTimes(1);
    expect(experiment.recordProposal.mock.calls[0][0].selectedArm).toBeNull();
  });

  it("overrides with the LinUCB pick and records a LINUCB proposal", async () => {
    const heuristicSlot = new Date("2026-06-09T09:00:00.000Z");
    const pick = {
      scheduledStartTime: new Date("2026-06-09T20:00:00.000Z"),
      selectedArm: "NIGHT",
      featureVector: new Array<number>(46).fill(0),
    };
    const { svc, sessionUpdate, experiment } = makeDeps({
      heuristicStart: heuristicSlot,
      policy: "LINUCB",
      pick,
    });

    const res = await svc.placeOnCreate({ user, task, now });

    expect(res).toEqual({
      scheduledStartTime: pick.scheduledStartTime,
      appliedPolicy: "LINUCB",
    });
    // heuristic write then LinUCB override write.
    expect(sessionUpdate).toHaveBeenCalledTimes(2);
    expect(experiment.recordProposal).toHaveBeenCalledTimes(1);
    expect(experiment.recordProposal.mock.calls[0][0].selectedArm).toBe(
      "NIGHT",
    );
  });

  it("falls back to the heuristic placement when the bandit throws", async () => {
    const slot = new Date("2026-06-09T09:00:00.000Z");
    const { svc, experiment } = makeDeps({
      heuristicStart: slot,
      policy: "LINUCB",
      banditThrows: true,
    });

    const res = await svc.placeOnCreate({ user, task, now });

    expect(res).toEqual({
      scheduledStartTime: slot,
      appliedPolicy: "HEURISTIC",
    });
    // The throw happened before recordProposal — best-effort, no crash.
    expect(experiment.recordProposal).not.toHaveBeenCalled();
  });

  it("reports NONE when nothing free fits", async () => {
    const { svc } = makeDeps({ heuristicStart: null, policy: "HEURISTIC" });
    const res = await svc.placeOnCreate({ user, task, now });
    expect(res).toEqual({ scheduledStartTime: null, appliedPolicy: "NONE" });
  });
});
