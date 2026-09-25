import { SchedulingModel, type User } from "../../generated/prisma";
import { SlotPickService } from "./slot-pick.service";
import { SLOT_TAKEN_MESSAGE, SlotTakenException } from "./slot-taken.exception";

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

function makeService(
  existing: ReturnType<typeof row>,
  siblings: { scheduledStartTime: Date; durationMinutes: number }[] = [],
) {
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
    session: {
      findFirst: jest.fn().mockResolvedValue(existing),
      findMany: jest.fn().mockResolvedValue(siblings),
    },
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
  return { service, schedulingFeedback, prisma, tx };
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

describe("SlotPickService — series sibling clash (#58)", () => {
  const seriesRow = () => row({ seriesId: "series-1", sessionIndex: 1 });

  it("409 SLOT_TAKEN when the alternative overlaps a live sibling; nothing moved or recorded", async () => {
    const { service, prisma, tx } = makeService(seriesRow(), [
      // 10:30-11:30 overlaps the 10:00-11:00 alternative
      {
        scheduledStartTime: new Date("2026-06-11T10:30:00.000Z"),
        durationMinutes: 60,
      },
    ]);

    const err = await service
      .recordPick(
        "task-1",
        { slotProposalId: "prop-1", chose: "alternative" },
        user,
      )
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(SlotTakenException);
    expect((err as SlotTakenException).getStatus()).toBe(409);
    expect((err as SlotTakenException).getResponse()).toEqual({
      success: false,
      statusCode: 409,
      message: SLOT_TAKEN_MESSAGE,
      code: "SLOT_TAKEN",
    });
    const [query] = prisma.session.findMany.mock.calls[0] as [
      { where: Record<string, unknown> },
    ];
    expect(query.where).toMatchObject({
      seriesId: "series-1",
      deleted: false,
      id: { not: "task-1" },
    });
    expect(tx.session.update).not.toHaveBeenCalled();
    expect(tx.sessionEvent.create).not.toHaveBeenCalled();
    expect(prisma.slotProposal.update).not.toHaveBeenCalled();
  });

  it("applies the alternative when siblings only touch it (half-open intervals)", async () => {
    const { service, tx, prisma } = makeService(seriesRow(), [
      {
        scheduledStartTime: new Date("2026-06-11T11:00:00.000Z"),
        durationMinutes: 60,
      },
      {
        scheduledStartTime: new Date("2026-06-11T09:00:00.000Z"),
        durationMinutes: 60,
      },
    ]);

    const res = await service.recordPick(
      "task-1",
      { slotProposalId: "prop-1", chose: "alternative" },
      user,
    );

    expect(res.chosenByUser).toBe("alternative");
    expect(tx.session.update).toHaveBeenCalled();
    expect(prisma.slotProposal.update).toHaveBeenCalledWith({
      where: { id: "prop-1" },
      data: { chosenByUser: SchedulingModel.LINUCB },
    });
  });

  it("a non-series session never queries siblings", async () => {
    const { service, prisma } = makeService(row());
    await service.recordPick(
      "task-1",
      { slotProposalId: "prop-1", chose: "alternative" },
      user,
    );
    expect(prisma.session.findMany).not.toHaveBeenCalled();
  });
});
