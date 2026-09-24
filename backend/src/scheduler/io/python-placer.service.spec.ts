import type { PlacedMember, PlaceResponse } from "@zenflow/shared";
import type { User } from "../../../generated/prisma";
import { ScheduleInfeasibleException } from "../schedule-infeasible.exception";
import { SchedulerDegradedException } from "../schedule-degraded.exception";
import { PythonPlacer } from "./python-placer.service";

const user = {
  id: "u1",
  timezone: "UTC",
  preferenceMatrix: [] as number[],
} as unknown as User;
const now = new Date("2026-06-08T00:00:00.000Z");
const deadline = new Date("2026-06-10T00:00:00.000Z");
const task = { id: "t1", durationMinutes: 60, deadline };
const START = Date.parse("2026-06-08T09:00:00.000Z");

const member = (over: Partial<PlacedMember> = {}): PlacedMember => ({
  id: "t1",
  outcome: "PLACED",
  appliedPolicy: "HEURISTIC",
  heuristic: { startMs: START, score: 1 },
  linucb: null,
  startMs: START,
  moves: [],
  late: false,
  conflicting: false,
  ...over,
});

const response = (results: PlacedMember[]): PlaceResponse => ({
  contractVersion: 1,
  requestId: "r",
  paramsVersion: "pv-1",
  results,
  timingsMs: {
    decode: 0,
    context: 0,
    predict: 0,
    scan: 0,
    displace: 0,
    total: 0,
  },
});

type Assign = {
  primaryPolicy: "HEURISTIC" | "LINUCB";
  pairwiseShown: boolean;
  randomizationSeed: string;
};

function make(opts: {
  place?: unknown; // gateway.placeSingleTwoPhase / place result
  fallbackSingle?: Date | null;
  fallbackSeries?: { id: string; scheduledStartTime: Date | null }[];
  assign?: Partial<Assign>;
}) {
  const assignment: Assign = {
    primaryPolicy: "HEURISTIC",
    pairwiseShown: false,
    randomizationSeed: "seed",
    ...opts.assign,
  };
  const prisma = {
    session: {
      update: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
  const gateway = {
    buildRequest: jest.fn().mockResolvedValue({ requestId: "r" }),
    placeSingleTwoPhase: jest.fn().mockResolvedValue(opts.place),
    place: jest.fn().mockResolvedValue(opts.place),
  };
  const fallback = {
    placeSingle: jest.fn().mockResolvedValue(opts.fallbackSingle ?? null),
    placeSeries: jest.fn().mockResolvedValue(opts.fallbackSeries ?? []),
  };
  const experiment = {
    assignPolicy: jest.fn().mockReturnValue(assignment),
    recordProposal: jest.fn().mockResolvedValue("sp1"),
  };
  const displacement = {
    applyMoves: jest
      .fn()
      .mockResolvedValue([{ id: "x", from: new Date(1), to: new Date(2) }]),
  };
  const placer = new PythonPlacer(
    prisma as never,
    gateway as never,
    fallback as never,
    experiment as never,
    displacement as never,
  );
  return { placer, prisma, gateway, fallback, experiment, displacement };
}

const ok = (results: PlacedMember[]) => ({
  ok: true as const,
  response: response(results),
});
const down = (reason: string) => ({ ok: false as const, reason });

describe("PythonPlacer.placeSingle (python answers)", () => {
  it("writes Python's start and records a PYTHON proposal stamped with paramsVersion", async () => {
    const { placer, prisma, experiment } = make({ place: ok([member()]) });
    const res = await placer.placeSingle(user, task, "create", now);
    expect(res.scheduledStartTime?.getTime()).toBe(START);
    expect(res.degraded).toBeUndefined();
    expect(res.appliedPolicy).toBe("HEURISTIC");
    expect(prisma.session.update).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: { scheduledStartTime: new Date(START) },
    });
    expect(experiment.recordProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        placementSource: "PYTHON",
        degradedReason: null,
        modelVersion: "pv-1",
        proposedStartTime: new Date(START),
      }),
    );
  });

  it("applies displacement moves and reports them", async () => {
    const moved = member({
      outcome: "DISPLACED",
      moves: [{ id: "x", fromMs: 1, toMs: 2 }],
    });
    const { placer, displacement } = make({ place: ok([moved]) });
    const res = await placer.placeSingle(user, task, "create", now);
    expect(displacement.applyMoves).toHaveBeenCalledWith(
      "u1",
      [{ id: "x", fromMs: 1, toMs: 2 }],
      expect.any(Function),
    );
    expect(res.displaced).toHaveLength(1);
  });

  it("records the LinUCB pick, weights and pairwise alternative", async () => {
    const lin = START + 3_600_000;
    const r = member({
      appliedPolicy: "LINUCB",
      startMs: lin,
      linucb: {
        startMs: lin,
        score: 2,
        selectedArm: "MORNING",
        featureVector: [0.1],
        weights: { wL: 1, wS: 0 },
      },
    });
    const { placer, experiment } = make({
      place: ok([r]),
      assign: { primaryPolicy: "LINUCB", pairwiseShown: true },
    });
    const res = await placer.placeSingle(user, task, "create", now);
    expect(res.appliedPolicy).toBe("LINUCB");
    expect(res.divergent).toBe(true);
    expect(res.alternativeSlot?.getTime()).toBe(START);
    expect(experiment.recordProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedArm: "MORNING",
        featureVector: [0.1],
        weights: { wL: 1, wS: 0 },
        pairwiseShown: true,
      }),
    );
  });

  it("an INFEASIBLE answer leaves the task unplaced (no write)", async () => {
    const r = member({
      outcome: "INFEASIBLE",
      startMs: null,
      heuristic: null,
      appliedPolicy: "NONE",
    });
    const { placer, prisma } = make({ place: ok([r]) });
    const res = await placer.placeSingle(user, task, "create", now);
    expect(res.scheduledStartTime).toBeNull();
    expect(res.appliedPolicy).toBe("NONE");
    expect(prisma.session.update).not.toHaveBeenCalled();
  });
});

describe("PythonPlacer.placeSingle (degraded, ADR-0003 2.4)", () => {
  it("free slot: heuristic start, degraded flag, TS_FALLBACK proposal without model data", async () => {
    const start = new Date(START);
    const { placer, prisma, experiment } = make({
      place: down("breaker_open"),
      fallbackSingle: start,
      assign: { primaryPolicy: "LINUCB", pairwiseShown: true },
    });
    const res = await placer.placeSingle(
      user,
      task,
      "create",
      now,
      "ACCEPT_LATE_DEADLINE",
    );
    expect(res.degraded).toBe(true);
    expect(res.appliedPolicy).toBe("HEURISTIC");
    expect(res.scheduledStartTime).toEqual(start);
    expect(res.displaced).toBeUndefined();
    expect(prisma.session.update).toHaveBeenCalledTimes(1);
    expect(experiment.recordProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        primaryPolicy: "LINUCB", // rolled policy is still recorded
        placementSource: "TS_FALLBACK",
        degradedReason: "breaker_open",
        modelProposal: null,
        modelVersion: null,
        selectedArm: null,
        pairwiseShown: false,
      }),
    );
  });

  it("no free slot, no policy: unplaced like a Python INFEASIBLE (never a 503)", async () => {
    const { placer, prisma, experiment, fallback } = make({
      place: down("timeout"),
      fallbackSingle: null,
    });
    const res = await placer.placeSingle(user, task, "create", now);
    expect(res).toMatchObject({
      scheduledStartTime: null,
      appliedPolicy: "NONE",
      degraded: true,
    });
    expect(fallback.placeSingle).toHaveBeenCalledTimes(1);
    expect(prisma.session.update).not.toHaveBeenCalled();
    expect(experiment.recordProposal).not.toHaveBeenCalled();
  });

  it("no free slot + policy: best slot up to 30 days past the deadline", async () => {
    const late = new Date(deadline.getTime() + 3_600_000);
    const { placer, prisma, fallback } = make({ place: down("breaker_open") });
    fallback.placeSingle
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(late);
    const res = await placer.placeSingle(
      user,
      task,
      "create",
      now,
      "ACCEPT_LATE_DEADLINE",
    );
    expect(res.scheduledStartTime).toEqual(late);
    const widened = fallback.placeSingle.mock.calls[1] as [
      string,
      { deadline: Date },
    ];
    expect(widened[1].deadline).toEqual(
      new Date(deadline.getTime() + 30 * 86_400_000),
    );
    expect(prisma.session.update).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: { scheduledStartTime: late },
    });
  });

  it("the exception body carries the shared 503 code", () => {
    const body = new SchedulerDegradedException().getResponse() as {
      code: string;
      statusCode: number;
      success: boolean;
    };
    expect(body).toMatchObject({
      success: false,
      statusCode: 503,
      code: "SCHEDULER_DEGRADED",
    });
  });
});

describe("PythonPlacer.preflightSingle", () => {
  const args = { user, durationMinutes: 60, deadline, now };

  it("passes when Python can place, displace or accept", async () => {
    for (const outcome of ["PLACED", "DISPLACED", "ACCEPTED_LATE"] as const) {
      const { placer } = make({ place: ok([member({ outcome })]) });
      await expect(placer.preflightSingle(args)).resolves.toBeUndefined();
    }
  });

  it("INFEASIBLE without a policy => 409; with a policy => allowed", async () => {
    const infeasible = ok([member({ outcome: "INFEASIBLE", startMs: null })]);
    await expect(
      make({ place: infeasible }).placer.preflightSingle(args),
    ).rejects.toBeInstanceOf(ScheduleInfeasibleException);
    await expect(
      make({ place: infeasible }).placer.preflightSingle({
        ...args,
        policy: "ACCEPT_CONFLICTS",
      }),
    ).resolves.toBeUndefined();
  });

  it("degraded: free slot passes; none => 409 w/o policy, allowed with one", async () => {
    await expect(
      make({
        place: down("connect"),
        fallbackSingle: new Date(START),
      }).placer.preflightSingle(args),
    ).resolves.toBeUndefined();
    await expect(
      make({
        place: down("connect"),
        fallbackSingle: null,
      }).placer.preflightSingle(args),
    ).rejects.toBeInstanceOf(ScheduleInfeasibleException);
    await expect(
      make({
        place: down("connect"),
        fallbackSingle: null,
      }).placer.preflightSingle({
        ...args,
        policy: "ACCEPT_LATE_DEADLINE",
      }),
    ).resolves.toBeUndefined();
  });
});

describe("PythonPlacer series", () => {
  const members = [
    { id: "a", durationMinutes: 60 },
    { id: "b", durationMinutes: 60 },
  ];
  const seriesArgs = {
    user,
    members,
    deadline,
    now,
    trigger: "create" as const,
  };

  it("python: one row per member, a proposal per member", async () => {
    const results = [
      member({ id: "a", startMs: START }),
      member({ id: "b", startMs: START + 86_400_000 }),
    ];
    const { placer, experiment, gateway } = make({ place: ok(results) });
    const rows = await placer.placeSeries(seriesArgs);
    expect(gateway.place).toHaveBeenCalledTimes(1);
    expect(rows.map((r) => r.scheduledStartTime?.getTime())).toEqual([
      START,
      START + 86_400_000,
    ]);
    expect(experiment.recordProposal).toHaveBeenCalledTimes(2);
  });

  it("python: a member without a PLACED outcome comes back null", async () => {
    const results = [
      member({ id: "a" }),
      member({
        id: "b",
        outcome: "NEEDS_INFEASIBLE_CONTEXT",
        startMs: null,
      }),
    ];
    const { placer } = make({ place: ok(results) });
    const rows = await placer.placeSeries(seriesArgs);
    expect(rows[1].scheduledStartTime).toBeNull();
  });

  it("degraded: all members placed => rows flagged degraded + TS_FALLBACK proposals", async () => {
    const { placer, experiment } = make({
      place: down("timeout"),
      fallbackSeries: [
        { id: "a", scheduledStartTime: new Date(START) },
        { id: "b", scheduledStartTime: new Date(START + 86_400_000) },
      ],
    });
    const rows = await placer.placeSeries(seriesArgs);
    expect(rows.every((r) => r.degraded)).toBe(true);
    expect(experiment.recordProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        placementSource: "TS_FALLBACK",
        degradedReason: "timeout",
      }),
    );
  });

  it("degraded: a member without a slot comes back null, like Python (never a 503)", async () => {
    const { placer, experiment } = make({
      place: down("breaker_open"),
      fallbackSeries: [
        { id: "a", scheduledStartTime: new Date(START) },
        { id: "b", scheduledStartTime: null },
      ],
    });
    const rows = await placer.placeSeries(seriesArgs);
    expect(rows.map((r) => r.scheduledStartTime)).toEqual([
      new Date(START),
      null,
    ]);
    expect(experiment.recordProposal).toHaveBeenCalledTimes(1);
  });

  it("canPlaceSeries: python true only when every member is PLACED; degraded miss => false", async () => {
    const good = ok([member({ id: "a" }), member({ id: "b" })]);
    const bad = ok([
      member({ id: "a" }),
      member({ id: "b", outcome: "NEEDS_INFEASIBLE_CONTEXT", startMs: null }),
    ]);
    const a = { user, durationMinutes: 60, sessionCount: 2, deadline, now };
    expect(await make({ place: good }).placer.canPlaceSeries(a)).toBe(true);
    expect(await make({ place: bad }).placer.canPlaceSeries(a)).toBe(false);
    await expect(
      make({
        place: down("timeout"),
        fallbackSeries: [
          { id: "x", scheduledStartTime: new Date(START) },
          { id: "y", scheduledStartTime: null },
        ],
      }).placer.canPlaceSeries(a),
    ).resolves.toBe(false);
  });
});
