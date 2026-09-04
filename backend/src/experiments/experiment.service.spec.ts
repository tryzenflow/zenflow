/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
import { ExperimentService } from "./experiment.service";

const HEURISTIC_RESULT = {
  scheduledStartTime: "2026-06-15T09:00:00.000Z",
};

function make(overrides: Record<string, unknown> = {}) {
  const create = jest.fn().mockResolvedValue({});
  const count = jest.fn().mockResolvedValue(7);
  const prisma = {
    slotProposal: { create },
    sessionEvent: { count },
    ...overrides,
  };
  return {
    service: new ExperimentService(prisma as never),
    create,
    count,
  };
}

describe("ExperimentService.assignPolicy", () => {
  it("splits 50/50 on the injected rng and logs a 32-hex-char seed", () => {
    const { service } = make();
    const a = service.assignPolicy(() => 0.4);
    const b = service.assignPolicy(() => 0.6);
    expect(a.primaryPolicy).toBe("LINUCB");
    expect(b.primaryPolicy).toBe("HEURISTIC");
    expect(a.randomizationSeed).toMatch(/^[0-9a-f]{32}$/);
    expect(a.randomizationSeed).not.toBe(b.randomizationSeed);
  });
});

describe("ExperimentService.recordProposal", () => {
  it("writes a LinUCB proposal with the model fields populated", async () => {
    const { service, create } = make();
    const start = new Date("2026-06-15T20:00:00.000Z");

    await service.recordProposal({
      userId: "u1",
      sessionId: "s1",
      trigger: "create",
      primaryPolicy: "LINUCB",
      randomizationSeed: "seed",
      heuristicProposal: HEURISTIC_RESULT,
      proposedStartTime: start,
      modelProposal: { scheduledStartTime: start, selectedArm: "NIGHT" },
      featureVector: [0.1, 0.2],
      selectedArm: "NIGHT",
    });

    const { data } = create.mock.calls[0][0];
    expect(data.event).toBe("CREATE");
    expect(data.primaryPolicy).toBe("LINUCB");
    expect(data.observationCount).toBe(7);
    expect(data.modelVersion).toBe("linucb-d46-v1");
    expect(data.selectedArm).toBe("NIGHT");
    expect(data.featureVector).toEqual([0.1, 0.2]);
    expect(data.modelProposal).toEqual({
      scheduledStartTime: start.toISOString(),
      selectedArm: "NIGHT",
    });
    expect(data.proposedStartTime).toBe(start);
  });

  it("writes a heuristic proposal with null model fields and no modelVersion", async () => {
    const { service, create } = make();
    await service.recordProposal({
      userId: "u1",
      sessionId: "s1",
      trigger: "deadline-change",
      primaryPolicy: "HEURISTIC",
      randomizationSeed: "seed",
      heuristicProposal: HEURISTIC_RESULT,
      proposedStartTime: null,
      modelProposal: null,
      featureVector: [],
      selectedArm: null,
    });

    const { data } = create.mock.calls[0][0];
    expect(data.event).toBe("DEADLINE_CHANGE");
    expect(data.modelVersion).toBeNull();
    expect(data.selectedArm).toBeNull();
  });

  it("never throws when the insert fails", async () => {
    const create = jest.fn().mockRejectedValue(new Error("db down"));
    const { service } = make({
      slotProposal: { create },
      sessionEvent: { count: jest.fn().mockResolvedValue(0) },
    });

    await expect(
      service.recordProposal({
        userId: "u1",
        sessionId: "s1",
        trigger: "create",
        primaryPolicy: "HEURISTIC",
        randomizationSeed: "seed",
        heuristicProposal: HEURISTIC_RESULT,
        proposedStartTime: null,
        modelProposal: null,
        featureVector: [],
        selectedArm: null,
      }),
    ).resolves.toBeUndefined();
  });
});
