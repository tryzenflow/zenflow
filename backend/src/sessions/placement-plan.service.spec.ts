import { NotFoundException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import type { PlacementMove } from "@zenflow/shared";
import type { User } from "../../generated/prisma";
import { PrismaService } from "../prisma/prisma.service";
import { DisplacementService } from "../scheduler/io/displacement.service";
import { wouldConflict } from "../scheduler/io/conflict-check";
import { RemindersService } from "../reminders/reminders.service";
import { SessionCrudService } from "./session-crud.service";
import { PlacementPlanService } from "./placement-plan.service";
import { PlacementStaleException } from "./placement-plan.exception";

jest.mock("../scheduler/io/conflict-check", () => ({
  wouldConflict: jest.fn(),
}));
jest.mock("./session-mapper", () => ({
  toSessionDto: jest.fn((row: { id: string }) => ({ id: row.id })),
}));

const user = {
  id: "u1",
  timezone: "UTC",
  defaultReminderMinutes: 0,
} as unknown as User;
const NOW = new Date("2026-06-08T00:00:00.000Z");
const HOUR = 60 * 60_000;
const START = NOW.getTime() + 10 * HOUR;
const MOVE: PlacementMove = {
  id: "chosen",
  fromMs: START,
  toMs: START + 2 * HOUR,
  anchor: "CHOSEN",
  cost: 12,
};

function planRow(over: Record<string, unknown> = {}) {
  return {
    id: "plan-1",
    userId: "u1",
    subjectId: null,
    subjectFrom: null,
    startAt: new Date(START + 4 * HOUR),
    moves: [MOVE],
    createInput: {
      type: "TASK",
      title: "Write report",
      durationMinutes: 60,
      deadline: "2026-06-10T00:00:00.000Z",
      tags: [],
      reminders: [],
    },
    expiresAt: new Date(NOW.getTime() + HOUR),
    createdAt: NOW,
    ...over,
  };
}

async function make() {
  const prisma = {
    placementPlan: {
      findFirst: jest.fn().mockResolvedValue(planRow()),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    session: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: "chosen",
          durationMinutes: 60,
          scheduledStartTime: new Date(START),
        },
      ]),
      findFirst: jest.fn(),
      findFirstOrThrow: jest.fn(),
      update: jest.fn().mockResolvedValue({ id: "new" }),
    },
    sessionEvent: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn(),
  };
  // Interactive transactions run against the same mock client.
  prisma.$transaction.mockImplementation(
    (cb: (tx: typeof prisma) => Promise<unknown>) => cb(prisma),
  );
  const displacement = {
    moveWrites: jest.fn().mockReturnValue([]),
  };
  const crud = {
    insertSingleTask: jest.fn().mockResolvedValue({ id: "new" }),
  };
  const reminders = {
    resolveForCreate: jest.fn().mockReturnValue([]),
    replace: jest.fn().mockResolvedValue({ applied: [], skipped: [] }),
  };
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      PlacementPlanService,
      { provide: PrismaService, useValue: prisma },
      { provide: DisplacementService, useValue: displacement },
      { provide: SessionCrudService, useValue: crud },
      { provide: RemindersService, useValue: reminders },
    ],
  }).compile();
  const svc = module.get<PlacementPlanService>(PlacementPlanService);
  return { svc, prisma, displacement, crud, reminders };
}

beforeEach(() => {
  (wouldConflict as jest.Mock).mockResolvedValue(false);
});

describe("PlacementPlanService.confirm", () => {
  it("is not found for a plan that does not belong to the user", async () => {
    const { svc, prisma } = await make();
    prisma.placementPlan.findFirst.mockResolvedValue(null);
    await expect(svc.confirm(user, "plan-1", NOW)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.session.update).not.toHaveBeenCalled();
  });

  it("discards an expired plan and applies nothing", async () => {
    const { svc, prisma, crud } = await make();
    prisma.placementPlan.findFirst.mockResolvedValue(
      planRow({ expiresAt: new Date(NOW.getTime() - 1) }),
    );
    await expect(svc.confirm(user, "plan-1", NOW)).rejects.toBeInstanceOf(
      PlacementStaleException,
    );
    expect(prisma.placementPlan.deleteMany).toHaveBeenCalledTimes(1);
    expect(crud.insertSingleTask).not.toHaveBeenCalled();
  });

  it("refuses a plan whose moved session has moved since, and applies nothing", async () => {
    const { svc, prisma, crud, displacement } = await make();
    prisma.session.findMany.mockResolvedValue([
      {
        id: "chosen",
        durationMinutes: 60,
        scheduledStartTime: new Date(START + HOUR),
      },
    ]);
    await expect(svc.confirm(user, "plan-1", NOW)).rejects.toBeInstanceOf(
      PlacementStaleException,
    );
    expect(crud.insertSingleTask).not.toHaveBeenCalled();
    expect(displacement.moveWrites).not.toHaveBeenCalled();
  });

  it("refuses a plan whose target slot is taken now", async () => {
    const { svc, crud } = await make();
    (wouldConflict as jest.Mock).mockResolvedValue(true);
    await expect(svc.confirm(user, "plan-1", NOW)).rejects.toBeInstanceOf(
      PlacementStaleException,
    );
    expect(crud.insertSingleTask).not.toHaveBeenCalled();
  });

  it("inserts the create and applies every move under one undo group", async () => {
    const { svc, displacement, crud } = await make();
    const res = await svc.confirm(user, "plan-1", NOW);

    expect(crud.insertSingleTask).toHaveBeenCalledTimes(1);
    expect(displacement.moveWrites).toHaveBeenCalledWith(
      expect.anything(),
      "u1",
      [{ id: "chosen", fromMs: START, toMs: MOVE.toMs }],
      expect.any(Function),
      res.undoGroupId,
    );
    expect(res.undoGroupId).toEqual(expect.any(String));
    expect(res.displacedSessions).toEqual([
      {
        id: "chosen",
        from: new Date(START).toISOString(),
        to: new Date(MOVE.toMs).toISOString(),
      },
    ]);
  });

  it("is single use: a second claim of the same plan is not found", async () => {
    const { svc, prisma } = await make();
    prisma.placementPlan.deleteMany.mockResolvedValue({ count: 0 });
    await expect(svc.confirm(user, "plan-1", NOW)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.session.update).not.toHaveBeenCalled();
  });
});

describe("PlacementPlanService.undo", () => {
  const event = (
    sessionId: string,
    from: number,
    to: number,
  ): Record<string, unknown> => ({
    sessionId,
    oldSnapshot: { scheduledStartTime: new Date(from).toISOString() },
    newSnapshot: { scheduledStartTime: new Date(to).toISOString() },
  });

  it("is not found for an unknown group", async () => {
    const { svc } = await make();
    await expect(svc.undo(user, "g1")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("restores sessions still at their moved start and skips the rest", async () => {
    const { svc, prisma } = await make();
    const A_FROM = START;
    const A_TO = START + HOUR;
    const B_FROM = START + 2 * HOUR;
    const B_TO = START + 3 * HOUR;
    prisma.sessionEvent.findMany.mockResolvedValue([
      event("a", A_FROM, A_TO),
      event("b", B_FROM, B_TO),
    ]);
    prisma.session.findFirst.mockImplementation(
      ({ where }: { where: { id: string } }) =>
        Promise.resolve({
          scheduledStartTime: new Date(where.id === "a" ? A_TO : B_TO + HOUR),
        }),
    );

    const res = await svc.undo(user, "g1");

    expect(prisma.session.update).toHaveBeenCalledTimes(1);
    expect(prisma.session.update).toHaveBeenCalledWith({
      where: { id: "a" },
      data: { scheduledStartTime: new Date(A_FROM) },
    });
    expect(res.restored).toEqual([
      {
        id: "a",
        from: new Date(A_TO).toISOString(),
        to: new Date(A_FROM).toISOString(),
      },
    ]);
    expect(res.skippedSessionIds).toEqual(["b"]);
  });
});
