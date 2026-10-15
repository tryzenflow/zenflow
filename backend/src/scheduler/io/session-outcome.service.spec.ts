/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
import { Test, TestingModule } from "@nestjs/testing";
import { SessionOutcomeService } from "./session-outcome.service";
import { SchedulingFeedbackService } from "./scheduling-feedback.service";
import { PrismaService } from "../../prisma/prisma.service";
import { BanditService } from "../../bandit/bandit.service";
import { BanditArmStateRepository } from "../../bandit/bandit-arm-state.repository";
import {
  OUTCOME_GRACE_MS,
  OUTCOME_MISS_CUTOFF_MS,
} from "../../common/constants";
import { BANDIT_MODEL_VERSION } from "../constants";

interface Row {
  id: string;
  userId: string;
  type: string;
  scheduledStartTime: Date | null;
  durationMinutes: number;
  completedAt: Date | null;
  skipped: boolean;
  tags: { name: string }[];
  user: { timezone: string };
}

const START = new Date("2026-06-15T08:00:00.000Z");
const END = new Date("2026-06-15T09:00:00.000Z");
/** Elapsed past end + grace, before the miss cutoff. */
const SETTLE_NOW = new Date(END.getTime() + OUTCOME_GRACE_MS);
/** Past end + cutoff. */
const MISS_NOW = new Date(END.getTime() + OUTCOME_MISS_CUTOFF_MS);

function row(over: Partial<Row> & { id: string }): Row {
  return {
    userId: "user-1",
    type: "TASK",
    scheduledStartTime: START,
    durationMinutes: 60,
    completedAt: null,
    skipped: false,
    tags: [],
    user: { timezone: "UTC" },
    ...over,
  };
}

async function makeService(
  batches: Row[][],
  opts: {
    proposal?: Record<string, unknown> | null;
    checkOffEventId?: bigint | null;
  } = {},
) {
  const updates: { id: string; data: Record<string, unknown> }[] = [];
  const events: Record<string, unknown>[] = [];
  const eventUpdates: { id: bigint; data: Record<string, unknown> }[] = [];
  const userUpdates: { id: string; data: Record<string, unknown> }[] = [];

  const findMany = jest.fn();
  batches.forEach((b) => findMany.mockResolvedValueOnce(b));
  findMany.mockResolvedValue([]);

  let eventSeq = 0;
  const claimedIds = new Set<string>();
  const tx = {
    session: {
      // Claim semantics: only the first updateMany per id wins.
      updateMany: jest.fn(
        (args: { where: { id: string }; data: Record<string, unknown> }) => {
          if (claimedIds.has(args.where.id))
            return Promise.resolve({ count: 0 });
          claimedIds.add(args.where.id);
          updates.push({ id: args.where.id, data: args.data });
          return Promise.resolve({ count: 1 });
        },
      ),
    },
    sessionEvent: {
      findFirst: jest.fn(() =>
        Promise.resolve(
          opts.checkOffEventId === undefined || opts.checkOffEventId === null
            ? null
            : { id: opts.checkOffEventId },
        ),
      ),
      updateMany: jest.fn(
        (args: { where: { id: bigint }; data: Record<string, unknown> }) => {
          eventUpdates.push({ id: args.where.id, data: args.data });
          return Promise.resolve({ count: 1 });
        },
      ),
      create: jest.fn((args: { data: Record<string, unknown> }) => {
        events.push(args.data);
        return Promise.resolve({ id: BigInt(++eventSeq) });
      }),
    },
    user: {
      update: jest.fn(
        (args: { where: { id: string }; data: Record<string, unknown> }) => {
          userUpdates.push({ id: args.where.id, data: args.data });
          return Promise.resolve({});
        },
      ),
    },
    $queryRaw: jest.fn().mockResolvedValue([
      {
        preferenceMatrix: new Array<number>(168).fill(0),
        preferenceMatrixDecayedAt: null,
      },
    ]),
  };

  const banditUpdate = jest
    .fn()
    .mockResolvedValue({ A: [1, 0, 0, 1], b: [0.5, 0.5] });
  const armSave = jest.fn().mockResolvedValue(undefined);
  const bandit = { update: banditUpdate };
  const armStates = {
    loadAll: jest
      .fn()
      .mockResolvedValue({ MORNING: { A: [], b: [], version: 3 } }),
    save: armSave,
  };

  const prisma = {
    session: { findMany },
    slotProposal: {
      findFirst: jest
        .fn()
        .mockResolvedValue(opts.proposal === undefined ? null : opts.proposal),
    },
    sessionEvent: { update: jest.fn().mockResolvedValue({}) },
    $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
  };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      SessionOutcomeService,
      SchedulingFeedbackService,
      { provide: PrismaService, useValue: prisma },
      { provide: BanditService, useValue: bandit },
      { provide: BanditArmStateRepository, useValue: armStates },
    ],
  }).compile();

  return {
    service: module.get<SessionOutcomeService>(SessionOutcomeService),
    findMany,
    updates,
    events,
    eventUpdates,
    userUpdates,
    banditUpdate,
    armSave,
  };
}

describe("SessionOutcomeService.sweep", () => {
  describe("completion", () => {
    it("settles a check-off inside the slot as +1 on the COMPLETE event", async () => {
      const { service, updates, events, eventUpdates } = await makeService(
        [
          [
            row({
              id: "s1",
              completedAt: new Date("2026-06-15T08:30:00.000Z"),
            }),
          ],
        ],
        { checkOffEventId: 7n },
      );

      expect(await service.sweep(SETTLE_NOW)).toBe(1);

      expect(updates).toEqual([{ id: "s1", data: { retainedAt: SETTLE_NOW } }]);
      expect(eventUpdates).toEqual([{ id: 7n, data: { rewardScore: 1 } }]);
      expect(events).toHaveLength(0);
    });

    it("counts a check-off at the exact start", async () => {
      const { service, eventUpdates } = await makeService(
        [[row({ id: "s1", completedAt: START })]],
        { checkOffEventId: 7n },
      );

      expect(await service.sweep(SETTLE_NOW)).toBe(1);
      expect(eventUpdates[0].data).toEqual({ rewardScore: 1 });
    });

    it("does not settle a completed session before end + grace", async () => {
      const { service, updates } = await makeService([
        [row({ id: "s1", completedAt: START })],
      ]);
      const justBefore = new Date(SETTLE_NOW.getTime() - 1);

      expect(await service.sweep(justBefore)).toBe(0);
      expect(updates).toHaveLength(0);
    });

    it("treats a check-off before the start as no check-off", async () => {
      const early = new Date("2026-06-15T07:50:00.000Z");
      const r = row({ id: "s1", completedAt: early });
      const { service, events, eventUpdates } = await makeService([[r], [r]], {
        checkOffEventId: 7n,
      });

      expect(await service.sweep(SETTLE_NOW)).toBe(0);
      expect(await service.sweep(MISS_NOW)).toBe(1);
      expect(eventUpdates).toHaveLength(0);
      expect(events[0].eventType).toBe("MISSED");
      expect(events[0].rewardScore).toBe(-1);
    });
  });

  describe("skip", () => {
    it("settles a skip as -1 on the SKIP event at end + grace", async () => {
      const { service, updates, eventUpdates } = await makeService(
        [[row({ id: "s1", skipped: true })]],
        { checkOffEventId: 9n },
      );

      expect(await service.sweep(SETTLE_NOW)).toBe(1);

      expect(updates).toEqual([{ id: "s1", data: { retainedAt: SETTLE_NOW } }]);
      expect(eventUpdates).toEqual([{ id: 9n, data: { rewardScore: -1 } }]);
    });

    it("wins over a completion timestamp", async () => {
      const { service, eventUpdates } = await makeService(
        [
          [
            row({
              id: "s1",
              skipped: true,
              completedAt: new Date("2026-06-15T08:10:00.000Z"),
            }),
          ],
        ],
        { checkOffEventId: 9n },
      );

      await service.sweep(SETTLE_NOW);
      expect(eventUpdates[0].data).toEqual({ rewardScore: -1 });
    });
  });

  describe("missed", () => {
    it("is not settled before the miss cutoff", async () => {
      const { service, updates, events } = await makeService([
        [row({ id: "s1" })],
      ]);
      const justBefore = new Date(MISS_NOW.getTime() - 1);

      expect(await service.sweep(justBefore)).toBe(0);
      expect(updates).toHaveLength(0);
      expect(events).toHaveLength(0);
    });

    it("writes a MISSED event with -1 when no check-off lands by the cutoff", async () => {
      const { service, updates, events } = await makeService([
        [row({ id: "s1" })],
      ]);

      expect(await service.sweep(MISS_NOW)).toBe(1);

      expect(updates).toEqual([{ id: "s1", data: { retainedAt: MISS_NOW } }]);
      expect(events).toHaveLength(1);
      expect(events[0].eventType).toBe("MISSED");
      expect(events[0].rewardScore).toBe(-1);
      expect(events[0].sessionId).toBe("s1");
    });
  });

  it("skips a session whose end + grace has not yet passed", async () => {
    const { service, updates, events } = await makeService([
      [
        row({
          id: "s1",
          scheduledStartTime: new Date("2026-06-15T10:59:00.000Z"),
          completedAt: new Date("2026-06-15T10:59:00.000Z"),
        }),
      ],
    ]);

    expect(await service.sweep(new Date("2026-06-15T12:00:00.000Z"))).toBe(0);
    expect(updates).toHaveLength(0);
    expect(events).toHaveLength(0);
  });

  it("only considers unmoved, unsettled, user-created TASKs", async () => {
    const { service, findMany } = await makeService([[]]);

    await service.sweep(SETTLE_NOW);

    expect(findMany.mock.calls[0][0].where).toMatchObject({
      type: "TASK",
      source: "USER",
      retainedAt: null,
      lastMovedAt: null,
      deleted: false,
    });
  });

  it("is idempotent: an overlapping sweep settles and records nothing twice", async () => {
    const r = row({ id: "s1", completedAt: START });
    const { service, events, eventUpdates } = await makeService([[r], [r]], {
      checkOffEventId: 7n,
    });

    expect(await service.sweep(SETTLE_NOW)).toBe(1);
    expect(await service.sweep(SETTLE_NOW)).toBe(0);
    expect(eventUpdates).toHaveLength(1);
    expect(events).toHaveLength(0);
  });

  it("paginates by cursor across full batches", async () => {
    const big = Array.from({ length: 100 }, (_, i) =>
      row({ id: `s${i}`, completedAt: START }),
    );
    const rest = [row({ id: "s100", completedAt: START })];
    const { service, findMany } = await makeService([big, rest]);

    expect(await service.sweep(SETTLE_NOW)).toBe(101);
    expect(findMany).toHaveBeenCalledTimes(2);
    expect(findMany.mock.calls[1][0].cursor).toEqual({ id: "s99" });
  });

  it("delivers +1 to the LinUCB arm for a completion", async () => {
    const { service, banditUpdate, armSave } = await makeService(
      [[row({ id: "s1", completedAt: START })]],
      {
        checkOffEventId: 7n,
        proposal: {
          id: "prop-1",
          selectedArm: "MORNING",
          featureVector: [0.1, 0.2, 0.3, -1, 0, 0.25, 1],
          modelVersion: BANDIT_MODEL_VERSION,
        },
      },
    );

    await service.sweep(SETTLE_NOW);

    expect(banditUpdate).toHaveBeenCalledTimes(1);
    const [arm, x, reward] = banditUpdate.mock.calls[0];
    expect(arm).toBe("MORNING");
    expect(x).toEqual([0.1, 0.2, 0.3, -1, 0, 0.25, 1]);
    expect(reward).toBe(1);
    expect(armSave).toHaveBeenCalledWith(
      "user-1",
      "MORNING",
      [1, 0, 0, 1],
      [0.5, 0.5],
      3,
    );
  });

  it("delivers -1 to the LinUCB arm for a missed placement", async () => {
    const { service, banditUpdate } = await makeService([[row({ id: "s1" })]], {
      proposal: {
        id: "prop-1",
        selectedArm: "MORNING",
        featureVector: [0.1, 0.2, 0.3, -1, 0, 0.25, 1],
        modelVersion: BANDIT_MODEL_VERSION,
      },
    });

    await service.sweep(MISS_NOW);

    expect(banditUpdate).toHaveBeenCalledTimes(1);
    expect(banditUpdate.mock.calls[0][2]).toBe(-1);
  });

  it("skips the bandit update when there is no LinUCB proposal", async () => {
    const { service, banditUpdate } = await makeService([
      [row({ id: "s1", completedAt: START })],
    ]);
    await service.sweep(SETTLE_NOW);
    expect(banditUpdate).not.toHaveBeenCalled();
  });

  it("reinforces the preference matrix on the kept hour only for a completion", async () => {
    const { service, userUpdates } = await makeService(
      [
        [
          row({
            id: "s1",
            scheduledStartTime: new Date("2026-06-15T09:00:00.000Z"), // Monday 09:00 UTC
            completedAt: new Date("2026-06-15T09:05:00.000Z"),
          }),
        ],
      ],
      { checkOffEventId: 7n },
    );

    await service.sweep(new Date("2026-06-15T11:00:00.000Z"));

    expect(userUpdates).toHaveLength(1);
    const written = userUpdates[0].data.preferenceMatrix as number[];
    // Monday (wd=1), hour 9 → index 9; PREFERENCE_LEARNING_RATE · 0.25.
    expect(written[9]).toBeCloseTo(0.05);
  });

  it("does not reinforce the preference matrix for a missed placement", async () => {
    const { service, userUpdates } = await makeService([[row({ id: "s1" })]]);

    await service.sweep(MISS_NOW);

    expect(userUpdates).toHaveLength(0);
  });
});
