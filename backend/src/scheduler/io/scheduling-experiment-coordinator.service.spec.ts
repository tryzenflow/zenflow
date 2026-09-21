/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
import { SchedulingExperimentCoordinator } from "./scheduling-experiment-coordinator.service";
import type { BanditPick } from "../types/placement.types";

/**
 * `SchedulingExperimentCoordinator.run` — the A/B assignment, bandit-routing,
 * winner pick, pairwise divergence, and `SlotProposal` write, all against a
 * fake `ExperimentService`. `TaskPlacementService` / `SeriesPlacer` only rely
 * on this returning the right outcome shape (`task-placement.service.spec.ts`
 * / `series-placer.service.spec.ts` cover their own wiring on top of it).
 */

const HEURISTIC_START = new Date("2026-06-09T09:00:00.000Z");
const BANDIT_PICK: BanditPick = {
  scheduledStartTime: new Date("2026-06-09T20:00:00.000Z"),
  selectedArm: "NIGHT",
  featureVector: [0.1, 0.2],
  weights: { wL: 0.3, wP: 1 },
};

function makeExperiment(over: {
  primaryPolicy?: "HEURISTIC" | "LINUCB";
  pairwiseShown?: boolean;
  proposalId?: string | null;
}) {
  return {
    assignPolicy: jest.fn().mockReturnValue({
      primaryPolicy: over.primaryPolicy ?? "HEURISTIC",
      pairwiseShown: over.pairwiseShown ?? false,
      randomizationSeed: "seed",
    }),
    recordProposal: jest.fn().mockResolvedValue(over.proposalId ?? "p1"),
  };
}

function makeInput(over: {
  heuristicStart?: Date | null;
  runBandit?: () => Promise<typeof BANDIT_PICK | null>;
}) {
  return {
    userId: "u1",
    sessionId: "s1",
    trigger: "create" as const,
    heuristicStart:
      over.heuristicStart === undefined ? HEURISTIC_START : over.heuristicStart,
    runBandit: over.runBandit ?? jest.fn().mockResolvedValue(null),
  };
}

describe("SchedulingExperimentCoordinator.run", () => {
  it("applies the heuristic start and never touches the bandit when HEURISTIC is primary and not pairwise-sampled", async () => {
    const experiment = makeExperiment({ primaryPolicy: "HEURISTIC" });
    const coordinator = new SchedulingExperimentCoordinator(
      experiment as never,
    );
    const runBandit = jest.fn().mockResolvedValue(BANDIT_PICK);

    const outcome = await coordinator.run(makeInput({ runBandit }));

    expect(runBandit).not.toHaveBeenCalled();
    expect(outcome.appliedStart).toBe(HEURISTIC_START);
    expect(outcome.appliedPolicy).toBe("HEURISTIC");
    expect(outcome.slotProposalId).toBe("p1");
    expect(outcome.alternativeSlot).toBeNull();
    expect(outcome.divergent).toBe(false);
  });

  it("runs the bandit and applies its pick when LINUCB is primary", async () => {
    const experiment = makeExperiment({ primaryPolicy: "LINUCB" });
    const coordinator = new SchedulingExperimentCoordinator(
      experiment as never,
    );
    const runBandit = jest.fn().mockResolvedValue(BANDIT_PICK);

    const outcome = await coordinator.run(makeInput({ runBandit }));

    expect(runBandit).toHaveBeenCalledTimes(1);
    expect(outcome.appliedStart).toBe(BANDIT_PICK.scheduledStartTime);
    expect(outcome.appliedPolicy).toBe("LINUCB");
    expect(outcome.banditAttempted).toBe(true);
  });

  it("falls back to the heuristic start when LINUCB is primary but the bandit produces nothing", async () => {
    const experiment = makeExperiment({ primaryPolicy: "LINUCB" });
    const coordinator = new SchedulingExperimentCoordinator(
      experiment as never,
    );

    const outcome = await coordinator.run(
      makeInput({ runBandit: jest.fn().mockResolvedValue(null) }),
    );

    expect(outcome.appliedStart).toBe(HEURISTIC_START);
    expect(outcome.appliedPolicy).toBe("HEURISTIC");
    expect(outcome.banditAttempted).toBe(true);
    expect(outcome.banditPick).toBeNull();
  });

  it("runs the bandit purely for comparison when HEURISTIC is primary but pairwise-sampled", async () => {
    const experiment = makeExperiment({
      primaryPolicy: "HEURISTIC",
      pairwiseShown: true,
    });
    const coordinator = new SchedulingExperimentCoordinator(
      experiment as never,
    );
    const runBandit = jest.fn().mockResolvedValue(BANDIT_PICK);

    const outcome = await coordinator.run(makeInput({ runBandit }));

    // Applied slot is still the heuristic's — HEURISTIC is primary.
    expect(runBandit).toHaveBeenCalledTimes(1);
    expect(outcome.appliedStart).toBe(HEURISTIC_START);
    expect(outcome.appliedPolicy).toBe("HEURISTIC");
    // The bandit's differing pick surfaces as the pairwise alternative.
    expect(outcome.alternativeSlot).toBe(BANDIT_PICK.scheduledStartTime);
    expect(outcome.divergent).toBe(true);
  });

  it("reports no divergence when the pairwise comparison agrees with the applied slot", async () => {
    const experiment = makeExperiment({
      primaryPolicy: "HEURISTIC",
      pairwiseShown: true,
    });
    const coordinator = new SchedulingExperimentCoordinator(
      experiment as never,
    );
    const agreeingPick = {
      ...BANDIT_PICK,
      scheduledStartTime: HEURISTIC_START,
    };

    const outcome = await coordinator.run(
      makeInput({ runBandit: jest.fn().mockResolvedValue(agreeingPick) }),
    );

    expect(outcome.divergent).toBe(false);
    expect(outcome.alternativeSlot).toBeNull();
  });

  it("never shows a pairwise alternative when the sampled bandit run comes back empty", async () => {
    const experiment = makeExperiment({
      primaryPolicy: "HEURISTIC",
      pairwiseShown: true,
    });
    const coordinator = new SchedulingExperimentCoordinator(
      experiment as never,
    );

    const outcome = await coordinator.run(
      makeInput({ runBandit: jest.fn().mockResolvedValue(null) }),
    );

    expect(outcome.alternativeSlot).toBeNull();
    expect(outcome.divergent).toBe(false);
    const proposalArgs = experiment.recordProposal.mock.calls[0][0];
    expect(proposalArgs.pairwiseShown).toBe(false);
    expect(proposalArgs.pairwisePositions).toBeNull();
  });

  it("records the proposal with the LinUCB primary's alternative being the heuristic's raw pick", async () => {
    const experiment = makeExperiment({
      primaryPolicy: "LINUCB",
      pairwiseShown: true,
    });
    const coordinator = new SchedulingExperimentCoordinator(
      experiment as never,
    );
    const divergingHeuristic = new Date("2026-06-09T07:00:00.000Z");

    const outcome = await coordinator.run(
      makeInput({
        heuristicStart: divergingHeuristic,
        runBandit: jest.fn().mockResolvedValue(BANDIT_PICK),
      }),
    );

    expect(outcome.appliedStart).toBe(BANDIT_PICK.scheduledStartTime);
    expect(outcome.alternativeSlot).toBe(divergingHeuristic);
    expect(outcome.divergent).toBe(true);
  });

  it("passes pairwiseShown/pairwisePositions to recordProposal only when the comparison actually ran", async () => {
    const experiment = makeExperiment({
      primaryPolicy: "HEURISTIC",
      pairwiseShown: true,
    });
    const coordinator = new SchedulingExperimentCoordinator(
      experiment as never,
    );

    await coordinator.run(
      makeInput({ runBandit: jest.fn().mockResolvedValue(BANDIT_PICK) }),
      () => 0.1, // rng for randomizePairwisePositions → "first"
    );

    const proposalArgs = experiment.recordProposal.mock.calls[0][0];
    expect(proposalArgs.pairwiseShown).toBe(true);
    expect(proposalArgs.pairwisePositions).toEqual({
      primaryPosition: "first",
    });
  });
});
