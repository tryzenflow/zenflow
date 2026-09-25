import { Test, TestingModule } from "@nestjs/testing";
import { PrismaService } from "../../prisma/prisma.service";
import { TaskPlacementService } from "./task-placement.service";
import { PythonPlacer } from "./python-placer.service";
import { ScheduleInfeasibleException } from "../schedule-infeasible.exception";

/**
 * `TaskPlacementService` is now a thin pass-through to {@link PythonPlacer}
 * (ADR-0003 phase 6): it owns only the `now + duration > deadline` arithmetic
 * guard and the series-deadline-change transaction, everything else
 * delegates straight to Python (which itself falls back to the frozen
 * heuristic internally — see `python-placer.service.spec.ts` and
 * `fallback-placer.service.spec.ts`).
 */

const python = {
  placeSingle: jest.fn(),
  preflightSingle: jest.fn(),
  canPlaceSeries: jest.fn(),
  placeSeries: jest.fn(),
};
beforeEach(() => {
  Object.values(python).forEach((m) => m.mockClear());
});

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

async function makeService(
  prisma: unknown = {},
): Promise<TaskPlacementService> {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      TaskPlacementService,
      { provide: PrismaService, useValue: prisma },
      { provide: PythonPlacer, useValue: python },
    ],
  }).compile();
  return module.get<TaskPlacementService>(TaskPlacementService);
}

describe("TaskPlacementService.placeOnCreate / placeOnDeadlineChange", () => {
  it("delegates single placement to PythonPlacer with the right trigger", async () => {
    const result = {
      scheduledStartTime: new Date("2026-06-08T10:00:00.000Z"),
      appliedPolicy: "HEURISTIC",
      slotProposalId: "sp",
      alternativeSlot: null,
      divergent: false,
    };
    python.placeSingle.mockResolvedValue(result);
    const svc = await makeService();

    const res = await svc.placeOnCreate({
      user,
      task,
      now,
      infeasiblePolicy: "ACCEPT_CONFLICTS",
    });

    expect(res).toBe(result);
    expect(python.placeSingle).toHaveBeenCalledWith(
      user,
      task,
      "create",
      now,
      "ACCEPT_CONFLICTS",
      true,
    );
  });

  it("placeOnDeadlineChange uses the deadline-change trigger", async () => {
    python.placeSingle.mockResolvedValue({
      scheduledStartTime: null,
      appliedPolicy: "NONE",
      slotProposalId: null,
      alternativeSlot: null,
      divergent: false,
    });
    const svc = await makeService();
    await svc.placeOnDeadlineChange({ user, task, now });
    expect(python.placeSingle).toHaveBeenCalledWith(
      user,
      task,
      "deadline-change",
      now,
      undefined,
      true,
    );
    await svc.placeOnDeadlineChange({
      user,
      task,
      now,
      allowLastResort: false,
    });
    expect(python.placeSingle).toHaveBeenLastCalledWith(
      user,
      task,
      "deadline-change",
      now,
      undefined,
      false,
    );
  });
});

describe("TaskPlacementService.preflightTask", () => {
  it("400s before calling Python when now + duration > deadline", async () => {
    const svc = await makeService();
    await expect(
      svc.preflightTask({
        user,
        taskId: "t1",
        durationMinutes: 180,
        deadline: new Date(now.getTime() + 60 * 60_000),
        now,
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(python.preflightSingle).not.toHaveBeenCalled();
  });

  it("arithmeticOnly returns before calling Python", async () => {
    const svc = await makeService();
    await expect(
      svc.preflightTask({
        user,
        durationMinutes: 60,
        deadline: task.deadline,
        now,
        arithmeticOnly: true,
      }),
    ).resolves.toBeUndefined();
    expect(python.preflightSingle).not.toHaveBeenCalled();
  });

  it("otherwise delegates the pre-flight to Python", async () => {
    python.preflightSingle.mockResolvedValue(undefined);
    const svc = await makeService();
    await svc.preflightTask({
      user,
      durationMinutes: 60,
      deadline: task.deadline,
      now,
      policy: "ACCEPT_LATE_DEADLINE",
    });
    expect(python.preflightSingle).toHaveBeenCalledWith({
      user,
      taskId: undefined,
      durationMinutes: 60,
      deadline: task.deadline,
      now,
      policy: "ACCEPT_LATE_DEADLINE",
    });
  });
});

describe("TaskPlacementService.canPlaceTask / canPlaceSeries", () => {
  it("canPlaceTask is true when Python's pre-flight does not throw", async () => {
    python.preflightSingle.mockResolvedValue(undefined);
    const svc = await makeService();
    const ok = await svc.canPlaceTask({
      user,
      durationMinutes: 60,
      deadline: task.deadline,
      now,
    });
    expect(ok).toBe(true);
  });

  it("canPlaceTask is false when Python throws ScheduleInfeasibleException", async () => {
    python.preflightSingle.mockRejectedValue(new ScheduleInfeasibleException());
    const svc = await makeService();
    const ok = await svc.canPlaceTask({
      user,
      durationMinutes: 60,
      deadline: task.deadline,
      now,
    });
    expect(ok).toBe(false);
  });

  it("canPlaceTask rethrows any other error", async () => {
    python.preflightSingle.mockRejectedValue(new Error("boom"));
    const svc = await makeService();
    await expect(
      svc.canPlaceTask({
        user,
        durationMinutes: 60,
        deadline: task.deadline,
        now,
      }),
    ).rejects.toThrow("boom");
  });

  it("canPlaceSeries delegates straight to Python", async () => {
    python.canPlaceSeries.mockResolvedValue(true);
    const svc = await makeService();
    const ok = await svc.canPlaceSeries({
      user,
      durationMinutes: 60,
      sessionCount: 3,
      deadline: task.deadline,
      now,
    });
    expect(ok).toBe(true);
    expect(python.canPlaceSeries).toHaveBeenCalledWith({
      user,
      durationMinutes: 60,
      sessionCount: 3,
      deadline: task.deadline,
      now,
    });
  });
});

describe("TaskPlacementService.placeSeriesOnCreate", () => {
  function prismaMock() {
    return {
      session: { update: jest.fn().mockReturnValue("update-one") },
      $transaction: jest.fn().mockResolvedValue(undefined),
    };
  }

  it("delegates to Python with the create trigger", async () => {
    const rows = [{ id: "m1", scheduledStartTime: new Date(now) }];
    python.placeSeries.mockResolvedValue(rows);
    const svc = await makeService(prismaMock());
    const res = await svc.placeSeriesOnCreate({
      user,
      seriesId: "s1",
      members: [{ id: "m1", durationMinutes: 60 }],
      deadline: task.deadline,
      now,
    });
    expect(res).toBe(rows);
    expect(python.placeSeries).toHaveBeenCalledWith({
      user,
      members: [{ id: "m1", durationMinutes: 60 }],
      deadline: task.deadline,
      now,
      trigger: "create",
    });
  });

  // Regression: series members must be persisted with their starts.
  it("persists every member's start and never writes a null one", async () => {
    const start1 = new Date("2026-06-08T09:00:00.000Z");
    const start2 = new Date("2026-06-09T09:00:00.000Z");
    python.placeSeries.mockResolvedValue([
      { id: "m1", scheduledStartTime: start1 },
      { id: "m2", scheduledStartTime: null },
      { id: "m3", scheduledStartTime: start2 },
    ]);
    const prisma = prismaMock();
    const svc = await makeService(prisma);

    await svc.placeSeriesOnCreate({
      user,
      seriesId: "s1",
      members: [
        { id: "m1", durationMinutes: 60 },
        { id: "m2", durationMinutes: 60 },
        { id: "m3", durationMinutes: 60 },
      ],
      deadline: task.deadline,
      now,
    });

    expect(prisma.session.update).toHaveBeenCalledTimes(2);
    expect(prisma.session.update).toHaveBeenCalledWith({
      where: { id: "m1" },
      data: { scheduledStartTime: start1 },
    });
    expect(prisma.session.update).toHaveBeenCalledWith({
      where: { id: "m3" },
      data: { scheduledStartTime: start2 },
    });
    expect(prisma.$transaction).toHaveBeenCalledWith([
      "update-one",
      "update-one",
    ]);
  });
});

describe("TaskPlacementService.redistributeSeries", () => {
  it("re-places only upcoming members and persists the new deadline + starts in one transaction", async () => {
    const past = {
      id: "past",
      durationMinutes: 60,
      scheduledStartTime: new Date("2026-06-07T00:00:00.000Z"),
    };
    const upcoming = {
      id: "future",
      durationMinutes: 60,
      scheduledStartTime: new Date("2026-06-09T00:00:00.000Z"),
    };
    const newStart = new Date("2026-06-09T12:00:00.000Z");
    const alt = new Date("2026-06-09T15:00:00.000Z");
    python.placeSeries.mockResolvedValue([
      {
        id: "future",
        scheduledStartTime: newStart,
        slotProposalId: "sp-f",
        alternativeSlot: alt,
        divergent: true,
      },
    ]);
    const transaction = jest.fn().mockResolvedValue(undefined);
    const prisma = {
      sessionSeries: { update: jest.fn().mockReturnValue("update-series") },
      session: {
        updateMany: jest.fn().mockReturnValue("update-many"),
        update: jest.fn().mockReturnValue("update-one"),
      },
      $transaction: transaction,
    };
    const svc = await makeService(prisma);

    const newDeadline = new Date("2026-06-20T00:00:00.000Z");
    const res = await svc.redistributeSeries({
      user,
      seriesId: "s1",
      members: [past, upcoming],
      newDeadline,
      now,
    });

    expect(python.placeSeries).toHaveBeenCalledWith({
      user,
      members: [{ id: "future", durationMinutes: 60 }],
      deadline: newDeadline,
      now,
      trigger: "deadline-change",
      fixedOccupied: [
        {
          start: past.scheduledStartTime.getTime(),
          end:
            past.scheduledStartTime.getTime() + past.durationMinutes * 60_000,
        },
      ],
    });
    expect(transaction).toHaveBeenCalledTimes(1);
    // Only the re-placed sitting carries its proposal / alternative (#58).
    expect(res).toEqual([
      {
        id: "past",
        scheduledStartTime: past.scheduledStartTime,
        slotProposalId: null,
        alternativeSlot: null,
        divergent: false,
      },
      {
        id: "future",
        scheduledStartTime: newStart,
        slotProposalId: "sp-f",
        alternativeSlot: alt,
        divergent: true,
      },
    ]);
  });
});

describe("TaskPlacementService.redistributeSeries never unschedules", () => {
  it("a member the placer returned no start for keeps its current start (no null write)", async () => {
    const upcoming = {
      id: "future",
      durationMinutes: 60,
      scheduledStartTime: new Date("2026-06-09T00:00:00.000Z"),
    };
    python.placeSeries.mockResolvedValue([
      { id: "future", scheduledStartTime: null },
    ]);
    const prisma = {
      sessionSeries: { update: jest.fn().mockReturnValue("update-series") },
      session: {
        updateMany: jest.fn().mockReturnValue("update-many"),
        update: jest.fn().mockReturnValue("update-one"),
      },
      $transaction: jest.fn().mockResolvedValue(undefined),
    };
    const svc = await makeService(prisma);

    const res = await svc.redistributeSeries({
      user,
      seriesId: "s1",
      members: [upcoming],
      newDeadline: new Date("2026-06-20T00:00:00.000Z"),
      now,
    });

    expect(prisma.session.update).not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalledWith([
      "update-series",
      "update-many",
    ]);
    expect(res).toEqual([
      {
        id: "future",
        scheduledStartTime: upcoming.scheduledStartTime,
        slotProposalId: null,
        alternativeSlot: null,
        divergent: false,
      },
    ]);
  });
});

describe("TaskPlacementService.planSeriesRespread", () => {
  it("a last-resort pick counts as no slot (to: null), so the caller moves sittings one by one", async () => {
    const a = {
      id: "a",
      durationMinutes: 60,
      scheduledStartTime: new Date("2026-06-09T09:00:00.000Z"),
    };
    python.placeSeries.mockResolvedValue([
      {
        id: "a",
        scheduledStartTime: new Date("2026-06-09T23:00:00.000Z"),
        lastResort: true,
      },
    ]);
    const prisma = {
      session: { findMany: jest.fn().mockResolvedValue([a]) },
    };
    const svc = await makeService(prisma);
    const plan = await svc.planSeriesRespread({
      user,
      seriesId: "s1",
      deadline: new Date("2026-06-10T00:00:00.000Z"),
      now,
    });
    expect(plan).toEqual([{ id: "a", from: a.scheduledStartTime, to: null }]);
  });

  it("re-places the series' upcoming sittings together and writes nothing", async () => {
    const past = {
      id: "past",
      durationMinutes: 60,
      scheduledStartTime: new Date("2026-06-07T00:00:00.000Z"),
    };
    const a = {
      id: "a",
      durationMinutes: 60,
      scheduledStartTime: new Date("2026-06-09T09:00:00.000Z"),
    };
    const b = {
      id: "b",
      durationMinutes: 60,
      scheduledStartTime: new Date("2026-06-09T10:00:00.000Z"),
    };
    const aTo = new Date("2026-06-09T09:00:00.000Z");
    const bTo = new Date("2026-06-11T09:00:00.000Z");
    python.placeSeries.mockResolvedValue([
      { id: "a", scheduledStartTime: aTo },
      { id: "b", scheduledStartTime: bTo },
    ]);
    const prisma = {
      session: {
        findMany: jest.fn().mockResolvedValue([past, a, b]),
        update: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    const svc = await makeService(prisma);
    const deadline = new Date("2026-06-20T00:00:00.000Z");

    const plan = await svc.planSeriesRespread({
      user,
      seriesId: "s1",
      deadline,
      now,
    });

    expect(python.placeSeries).toHaveBeenCalledWith(
      expect.objectContaining({
        members: [
          { id: "a", durationMinutes: 60 },
          { id: "b", durationMinutes: 60 },
        ],
        deadline,
        trigger: "deadline-change",
        fixedOccupied: [
          {
            start: past.scheduledStartTime.getTime(),
            end: past.scheduledStartTime.getTime() + 60 * 60_000,
          },
        ],
        // Never shown to the user => never recorded as pairwiseShown (#58).
        surfaceAlternatives: false,
      }),
    );
    expect(plan).toEqual([
      { id: "a", from: a.scheduledStartTime, to: aTo },
      { id: "b", from: b.scheduledStartTime, to: bTo },
    ]);
    expect(prisma.session.update).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
