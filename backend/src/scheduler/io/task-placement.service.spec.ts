/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Test, TestingModule } from "@nestjs/testing";
import { PrismaService } from "../../prisma/prisma.service";
import { SchedulingExperimentCoordinator } from "./scheduling-experiment-coordinator.service";
import { HeuristicPlacer } from "./heuristic-placer.service";
import { BanditPlacer } from "./bandit-placer.service";
import { SeriesPlacer } from "./series-placer.service";
import { TaskPlacementService } from "./task-placement.service";
import { DisplacementService } from "./displacement.service";

/**
 * `TaskPlacementService.placeOnCreate` / `placeOnDeadlineChange` — the single-TASK
 * A/B facade. The A/B assignment + pairwise/bandit routing itself is
 * `scheduling-experiment-coordinator.service.spec.ts`; here we prove the
 * heuristic-write → coordinator-run → override-write sequencing and that a
 * coordinator failure always leaves the heuristic placement standing. Series
 * placement is covered by `series-placer.service.spec.ts`.
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

async function makeTaskPlacementService(
  prisma: unknown,
  coordinator: unknown,
  heuristic: unknown,
  bandit: unknown,
  seriesPlacer: unknown,
  displacement: unknown = {
    plan: jest.fn().mockResolvedValue({ kind: "infeasible" }),
    applyMoves: jest.fn(),
    fallbackStart: jest.fn(),
  },
): Promise<TaskPlacementService> {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      TaskPlacementService,
      { provide: PrismaService, useValue: prisma },
      { provide: SchedulingExperimentCoordinator, useValue: coordinator },
      { provide: HeuristicPlacer, useValue: heuristic },
      { provide: BanditPlacer, useValue: bandit },
      { provide: SeriesPlacer, useValue: seriesPlacer },
      { provide: DisplacementService, useValue: displacement },
    ],
  }).compile();
  return module.get<TaskPlacementService>(TaskPlacementService);
}

async function makeDeps(over: {
  heuristicStart?: Date | null;
  policy?: "HEURISTIC" | "LINUCB";
  pick?: {
    scheduledStartTime: Date;
    selectedArm: string;
    featureVector: number[];
  };
  banditThrows?: boolean;
}) {
  const sessionUpdate = jest.fn().mockResolvedValue({});
  const prisma = { session: { update: sessionUpdate } };
  const heuristicStart =
    over.heuristicStart === undefined ? null : over.heuristicStart;
  const coordinator = {
    run: over.banditThrows
      ? jest.fn().mockRejectedValue(new Error("bandit down"))
      : jest.fn(async (input: { runBandit: () => Promise<unknown> }) => {
          const primaryPolicy = over.policy ?? "HEURISTIC";
          const banditPick =
            primaryPolicy === "LINUCB" ? await input.runBandit() : null;
          return {
            appliedStart: banditPick
              ? (banditPick as { scheduledStartTime: Date }).scheduledStartTime
              : heuristicStart,
            appliedPolicy: banditPick
              ? "LINUCB"
              : heuristicStart
                ? "HEURISTIC"
                : "NONE",
            assignedPolicy: primaryPolicy,
            banditAttempted: primaryPolicy === "LINUCB",
            banditPick,
            slotProposalId: banditPick ? "p1" : null,
            alternativeSlot: null,
            divergent: false,
          };
        }),
  };
  const heuristic = {
    placeTask: jest.fn().mockResolvedValue(heuristicStart),
  };
  const bandit = {
    placeTask: jest.fn().mockResolvedValue(over.pick ?? null),
  };
  const svc = await makeTaskPlacementService(
    prisma,
    coordinator,
    heuristic,
    bandit,
    { placeSeries: jest.fn() },
  );
  return { svc, sessionUpdate, coordinator, heuristic, bandit };
}

describe("TaskPlacementService.placeOnCreate", () => {
  it("keeps the heuristic placement and runs the coordinator when HEURISTIC is primary", async () => {
    const slot = new Date("2026-06-09T09:00:00.000Z");
    const { svc, sessionUpdate, coordinator, bandit } = await makeDeps({
      heuristicStart: slot,
      policy: "HEURISTIC",
    });

    const res = await svc.placeOnCreate({ user, task, now });

    expect(res).toEqual({
      scheduledStartTime: slot,
      appliedPolicy: "HEURISTIC",
      slotProposalId: null,
      alternativeSlot: null,
      divergent: false,
      displaced: undefined,
    });
    expect(sessionUpdate).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: { scheduledStartTime: slot },
    });
    expect(bandit.placeTask).not.toHaveBeenCalled();
    expect(coordinator.run).toHaveBeenCalledTimes(1);
  });

  it("overrides with the LinUCB pick and reports its proposal id", async () => {
    const heuristicSlot = new Date("2026-06-09T09:00:00.000Z");
    const pick = {
      scheduledStartTime: new Date("2026-06-09T20:00:00.000Z"),
      selectedArm: "NIGHT",
      featureVector: new Array<number>(22).fill(0),
    };
    const { svc, sessionUpdate } = await makeDeps({
      heuristicStart: heuristicSlot,
      policy: "LINUCB",
      pick,
    });

    const res = await svc.placeOnCreate({ user, task, now });

    expect(res).toEqual({
      scheduledStartTime: pick.scheduledStartTime,
      appliedPolicy: "LINUCB",
      slotProposalId: "p1",
      alternativeSlot: null,
      divergent: false,
      displaced: undefined,
    });
    // heuristic write then LinUCB override write.
    expect(sessionUpdate).toHaveBeenCalledTimes(2);
  });

  it("falls back to the heuristic placement when the coordinator throws", async () => {
    const slot = new Date("2026-06-09T09:00:00.000Z");
    const { svc, sessionUpdate } = await makeDeps({
      heuristicStart: slot,
      policy: "LINUCB",
      banditThrows: true,
    });

    const res = await svc.placeOnCreate({ user, task, now });

    expect(res).toEqual({
      scheduledStartTime: slot,
      appliedPolicy: "HEURISTIC",
      slotProposalId: null,
      alternativeSlot: null,
      divergent: false,
      displaced: undefined,
    });
    // Only the heuristic write happened — no override write followed the throw.
    expect(sessionUpdate).toHaveBeenCalledTimes(1);
  });

  it("reports NONE when nothing free fits", async () => {
    const { svc } = await makeDeps({
      heuristicStart: null,
      policy: "HEURISTIC",
    });
    const res = await svc.placeOnCreate({ user, task, now });
    expect(res).toEqual({
      scheduledStartTime: null,
      appliedPolicy: "NONE",
      slotProposalId: null,
      alternativeSlot: null,
      divergent: false,
      displaced: undefined,
    });
  });
});

describe("TaskPlacementService.canPlaceTask / canPlaceSeries", () => {
  it("canPlaceTask is true when the heuristic finds a slot, using a placeholder id (no row exists yet)", async () => {
    const slot = new Date("2026-06-09T09:00:00.000Z");
    const { svc, heuristic } = await makeDeps({ heuristicStart: slot });

    const ok = await svc.canPlaceTask({
      user,
      durationMinutes: 60,
      deadline: task.deadline,
      now,
    });

    expect(ok).toBe(true);
    expect(heuristic.placeTask.mock.calls[0][1].id).not.toBe("t1");
  });

  it("canPlaceTask is false when nothing fits, and touches no prisma/coordinator write", async () => {
    const { svc, sessionUpdate, coordinator } = await makeDeps({
      heuristicStart: null,
    });

    const ok = await svc.canPlaceTask({
      user,
      durationMinutes: 60,
      deadline: task.deadline,
      now,
    });

    expect(ok).toBe(false);
    expect(sessionUpdate).not.toHaveBeenCalled();
    expect(coordinator.run).not.toHaveBeenCalled();
  });

  it("canPlaceSeries is true only when every member gets a slot (dry run)", async () => {
    const seriesPlacer = {
      placeSeries: jest.fn().mockResolvedValue([
        { id: "p-0", scheduledStartTime: new Date("2026-06-02T09:00:00Z") },
        { id: "p-1", scheduledStartTime: new Date("2026-06-05T09:00:00Z") },
        { id: "p-2", scheduledStartTime: null },
      ]),
    };
    const svc = await makeTaskPlacementService({}, {}, {}, {}, seriesPlacer);

    const ok = await svc.canPlaceSeries({
      user,
      durationMinutes: 60,
      sessionCount: 3,
      deadline: task.deadline,
      now,
    });

    expect(ok).toBe(false);
    expect(seriesPlacer.placeSeries).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({ deadline: task.deadline }),
      "UTC",
      [],
      now,
      { trigger: "create", dryRun: true },
    );
  });
});

describe("TaskPlacementService displacement + infeasible policies (#62 B)", () => {
  const displacement = (over: Record<string, unknown> = {}) => ({
    plan: jest.fn().mockResolvedValue({ kind: "infeasible" }),
    applyMoves: jest.fn().mockResolvedValue([]),
    fallbackStart: jest.fn().mockResolvedValue(null),
    ...over,
  });
  const build = async (heuristicStart: Date | null, disp: unknown) => {
    const sessionUpdate = jest.fn().mockResolvedValue({});
    const prisma = {
      session: {
        update: sessionUpdate,
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: "f1", durationMinutes: 30 }]),
      },
    };
    const coordinator = {
      run: jest.fn().mockResolvedValue({
        appliedStart: heuristicStart,
        appliedPolicy: heuristicStart ? "HEURISTIC" : "NONE",
        assignedPolicy: "HEURISTIC",
        banditAttempted: false,
        banditPick: null,
        slotProposalId: null,
        alternativeSlot: null,
        divergent: false,
      }),
    };
    const heuristic = {
      placeTask: jest.fn().mockResolvedValue(heuristicStart),
    };
    const svc = await makeTaskPlacementService(
      prisma,
      coordinator,
      heuristic,
      { placeTask: jest.fn() },
      { placeSeries: jest.fn() },
      disp,
    );
    return { svc, sessionUpdate };
  };

  it("repacks flexible tasks when nothing is free and reports the displaced ones", async () => {
    const from = Date.parse("2026-06-09T09:00:00Z");
    const disp = displacement({
      plan: jest.fn().mockResolvedValue({
        kind: "placed",
        startMs: from,
        moves: [{ id: "f1", fromMs: from, toMs: from + 3_600_000 }],
      }),
      applyMoves: jest
        .fn()
        .mockResolvedValue([
          { id: "f1", from: new Date(from), to: new Date(from + 3_600_000) },
        ]),
    });
    const { svc, sessionUpdate } = await build(null, disp);
    const res = await svc.placeOnCreate({ user, task, now });
    expect(res.scheduledStartTime).toEqual(new Date(from));
    expect(res.displaced).toHaveLength(1);
    expect(disp.applyMoves).toHaveBeenCalledWith(
      "u1",
      expect.any(Array),
      expect.any(Function),
    );
    expect(sessionUpdate).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: { scheduledStartTime: new Date(from) },
    });
  });

  it("does not touch the calendar when a free slot exists", async () => {
    const disp = displacement();
    const { svc } = await build(new Date("2026-06-09T09:00:00Z"), disp);
    await svc.placeOnCreate({ user, task, now });
    expect(disp.plan).not.toHaveBeenCalled();
  });

  it("ACCEPT_LATE_DEADLINE places at the fallback start", async () => {
    const late = new Date("2026-06-10T02:00:00Z");
    const disp = displacement({
      fallbackStart: jest.fn().mockResolvedValue(late),
    });
    const { svc } = await build(null, disp);
    const res = await svc.placeOnCreate({
      user,
      task,
      now,
      infeasiblePolicy: "ACCEPT_LATE_DEADLINE",
    });
    expect(res.scheduledStartTime).toEqual(late);
    expect(disp.fallbackStart).toHaveBeenCalledWith(
      user,
      task,
      now,
      "ACCEPT_LATE_DEADLINE",
    );
  });

  it("ACCEPT_CONFLICTS places at the min-conflict start", async () => {
    const s = new Date("2026-06-09T10:00:00Z");
    const disp = displacement({
      fallbackStart: jest.fn().mockResolvedValue(s),
    });
    const { svc } = await build(null, disp);
    const res = await svc.placeOnCreate({
      user,
      task,
      now,
      infeasiblePolicy: "ACCEPT_CONFLICTS",
    });
    expect(res.scheduledStartTime).toEqual(s);
  });

  it("preflightTask: 409 when infeasible and no policy; passes with a policy or a plan", async () => {
    const { svc } = await build(null, displacement());
    await expect(
      svc.preflightTask({
        user,
        durationMinutes: 60,
        deadline: task.deadline,
        now,
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      svc.preflightTask({
        user,
        durationMinutes: 60,
        deadline: task.deadline,
        now,
        policy: "ACCEPT_LATE_DEADLINE",
      }),
    ).resolves.toBeUndefined();
    const { svc: svc2 } = await build(
      null,
      displacement({
        plan: jest
          .fn()
          .mockResolvedValue({ kind: "placed", startMs: 0, moves: [] }),
      }),
    );
    await expect(
      svc2.preflightTask({
        user,
        durationMinutes: 60,
        deadline: task.deadline,
        now,
      }),
    ).resolves.toBeUndefined();
  });

  it("preflightTask: 400 when now + duration > deadline (create/edit guard)", async () => {
    const { svc } = await build(new Date(), displacement());
    await expect(
      svc.preflightTask({
        user,
        taskId: "t1",
        durationMinutes: 180,
        deadline: new Date(now.getTime() + 60 * 60_000),
        now,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
