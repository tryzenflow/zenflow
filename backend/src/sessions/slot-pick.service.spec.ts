import { SchedulingModel, type User } from "../../generated/prisma";
import { SlotPickService } from "./slot-pick.service";

const user = {
  id: "user-1",
  timezone: "UTC",
} as unknown as User;

const OLD_START = new Date("2026-06-11T08:00:00.000Z");
const ALT_START = new Date("2026-06-11T10:00:00.000Z");

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "task-1",
    title: "Task",
    note: null,
    location: null,
    durationMinutes: 60,
    deadline: null,
    tags: [],
    series: null,
    type: "TASK",
    source: "USER",
    conflict: false,
    scheduledStartTime: OLD_START,
    lastMovedAt: null,
    retainedAt: null,
    userId: user.id,
    seriesId: null,
    sessionIndex: null,
    sessionTotal: null,
    externalKey: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function makeService(existing: ReturnType<typeof row>) {
  const proposal = {
    id: "prop-1",
    primaryPolicy: SchedulingModel.HEURISTIC,
    heuristicProposal: {},
    modelProposal: { scheduledStartTime: ALT_START.toISOString() },
    pairwiseShown: true,
    chosenByUser: null,
    firstModifiedAt: null,
  };
  const tx = {
    sessionEvent: { create: jest.fn().mockResolvedValue({ id: 7n }) },
    session: {
      update: jest
        .fn()
        .mockResolvedValue({ ...existing, scheduledStartTime: ALT_START }),
    },
  };
  const prisma = {
    slotProposal: {
      findFirst: jest.fn().mockResolvedValue(proposal),
      update: jest.fn().mockResolvedValue({}),
    },
    session: { findFirst: jest.fn().mockResolvedValue(existing) },
    $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
  };
  const schedulingFeedback = {
    onFirstMove: jest.fn().mockResolvedValue(undefined),
    reinforcePreferenceMove: jest.fn().mockResolvedValue(undefined),
  };
  const service = new SlotPickService(
    prisma as never,
    schedulingFeedback as never,
  );
  return { service, schedulingFeedback };
}

describe("SlotPickService — matrix reinforcement", () => {
  it("picking the alternative on a never-moved session reinforces the matrix like a drag (old hour down, new hour up)", async () => {
    const { service, schedulingFeedback } = makeService(row());

    await service.recordPick(
      "task-1",
      { slotProposalId: "prop-1", chose: "alternative" },
      user,
    );

    expect(schedulingFeedback.onFirstMove).toHaveBeenCalledWith(
      user.id,
      "task-1",
      7n,
      120,
    );
    expect(schedulingFeedback.reinforcePreferenceMove).toHaveBeenCalledWith(
      user.id,
      OLD_START.getTime(),
      ALT_START.getTime(),
      user.timezone,
      120,
    );
  });

  it("does not reinforce when the session was already moved", async () => {
    const { service, schedulingFeedback } = makeService(
      row({ lastMovedAt: new Date("2026-06-10T00:00:00.000Z") }),
    );

    await service.recordPick(
      "task-1",
      { slotProposalId: "prop-1", chose: "alternative" },
      user,
    );

    expect(schedulingFeedback.reinforcePreferenceMove).not.toHaveBeenCalled();
  });
});
