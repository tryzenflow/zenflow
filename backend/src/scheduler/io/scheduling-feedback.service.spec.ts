/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { SchedulingFeedbackService } from "./scheduling-feedback.service";

/**
 * `SchedulingFeedbackService.onFirstMove` — the delayed graded LinUCB penalty
 * for the first user drag of a LinUCB-placed session. Absorbs what
 * `sessions.service.spec.ts` used to assert about `applyBanditMoveFeedback`.
 */

function makeSvc(over: { proposal?: unknown; updateResult?: unknown }) {
  const slotFindFirst = jest.fn().mockResolvedValue(
    over.proposal === undefined
      ? {
          id: "p1",
          selectedArm: "MORNING",
          featureVector: [1, 0, 0, 1],
        }
      : over.proposal,
  );
  const eventUpdate = jest.fn().mockResolvedValue({});
  const prisma = {
    slotProposal: { findFirst: slotFindFirst },
    sessionEvent: { update: eventUpdate },
  };
  const bandit = {
    update: jest
      .fn()
      .mockResolvedValue(over.updateResult ?? { A: [1], b: [0.5] }),
  };
  const armStates = {
    loadAll: jest.fn().mockResolvedValue({
      MORNING: { A: [1, 0, 0, 1], b: [0.5, 0.5], version: 3 },
    }),
    save: jest.fn().mockResolvedValue(undefined),
  };
  const svc = new SchedulingFeedbackService(
    prisma as never,
    bandit as never,
    armStates as never,
  );
  return { svc, bandit, armStates, eventUpdate };
}

describe("SchedulingFeedbackService.onFirstMove", () => {
  it("grades a drag by displacement and pushes the reward to /update, then links the event", async () => {
    const { svc, bandit, armStates, eventUpdate } = makeSvc({});

    await svc.onFirstMove("u1", "s1", 42n, 120);

    // reward = -min(1, 120/240) = -0.5
    expect(bandit.update).toHaveBeenCalledWith("MORNING", [1, 0, 0, 1], -0.5, {
      A: [1, 0, 0, 1],
      b: [0.5, 0.5],
    });
    expect(armStates.save).toHaveBeenCalledWith("u1", "MORNING", [1], [0.5], 3);
    expect(eventUpdate).toHaveBeenCalledWith({
      where: { id: 42n },
      data: { slotProposalId: "p1", policy: "LINUCB" },
    });
  });

  it("sends reward 0 for a resize-only move (zero drag distance)", async () => {
    const { svc, bandit } = makeSvc({});
    await svc.onFirstMove("u1", "s1", 1n, 0);
    expect(bandit.update.mock.calls[0][2]).toBe(0);
  });

  it("does nothing when there is no LinUCB proposal for the session", async () => {
    const { svc, bandit } = makeSvc({ proposal: null });
    await svc.onFirstMove("u1", "s1", 1n, 60);
    expect(bandit.update).not.toHaveBeenCalled();
  });

  it("swallows a bandit failure without throwing", async () => {
    const { svc } = makeSvc({});
    // loadAll returns a state, /update rejects — must not bubble.
    const { svc: svc2, bandit } = makeSvc({});
    bandit.update.mockRejectedValueOnce(new Error("bandit down"));
    await expect(svc2.onFirstMove("u1", "s1", 1n, 60)).resolves.toBeUndefined();
    await expect(svc.onFirstMove("u1", "s1", 1n, 60)).resolves.toBeUndefined();
  });
});
