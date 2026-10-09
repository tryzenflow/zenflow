/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
import { Test, TestingModule } from "@nestjs/testing";
import { RetainedSessionsService } from "./retained-sessions.service";
import { SchedulingFeedbackService } from "./scheduling-feedback.service";
import { PrismaService } from "../../prisma/prisma.service";
import { BanditService } from "../../bandit/bandit.service";
import { BanditArmStateRepository } from "../../bandit/bandit-arm-state.repository";
import { RETAINED_GRACE_MS } from "../../common/constants";

interface Row {
  id: string;
  userId: string;
  type: string;
  scheduledStartTime: Date | null;
  durationMinutes: number;
  tags: { name: string }[];
  user: { timezone: string };
}

const NOW = new Date("2026-06-15T12:00:00.000Z");

function row(over: Partial<Row> & { id: string }): Row {
  return {
    userId: "user-1",
    type: "TASK",
    scheduledStartTime: new Date("2026-06-15T08:00:00.000Z"),
    durationMinutes: 60,
    tags: [],
    user: { timezone: "UTC" },
    ...over,
  };
}

async function makeService(
  batches: Row[][],
  opts: { proposal?: Record<string, unknown> | null } = {},
) {
  const updates: { id: string; data: Record<string, unknown> }[] = [];
  const events: Record<string, unknown>[] = [];
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
      RetainedSessionsService,
      SchedulingFeedbackService,
      { provide: PrismaService, useValue: prisma },
      { provide: BanditService, useValue: bandit },
      { provide: BanditArmStateRepository, useValue: armStates },
    ],
  }).compile();

  return {
    service: module.get<RetainedSessionsService>(RetainedSessionsService),
    findMany,
    updates,
    events,
    userUpdates,
    banditUpdate,
    armSave,
  };
}

describe("RetainedSessionsService.sweep", () => {
  it("marks an elapsed, never-moved TASK as retained with a positive reward", async () => {
    const { service, updates, events } = await makeService([
      [row({ id: "s1" })],
    ]);

    const count = await service.sweep(NOW);

    expect(count).toBe(1);
    expect(updates).toEqual([{ id: "s1", data: { retainedAt: NOW } }]);
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe("RETAINED");
    expect(events[0].rewardScore).toBeGreaterThan(0);
    expect(events[0].sessionId).toBe("s1");
  });

  it("is idempotent: an overlapping sweep records no second event", async () => {
    const r = row({ id: "s1" });
    const { service, events } = await makeService([[r], [r]]);

    const first = await service.sweep(NOW);
    const second = await service.sweep(NOW);

    expect(first).toBe(1);
    expect(second).toBe(0);
    expect(events).toHaveLength(1);
  });

  it("skips a session whose end + grace has not yet passed", async () => {
    const notElapsed = row({
      id: "s1",
      // ends at 11:59, +15m grace → 12:14, still in the future vs NOW 12:00
      scheduledStartTime: new Date("2026-06-15T10:59:00.000Z"),
      durationMinutes: 60,
    });
    const { service, updates, events } = await makeService([[notElapsed]]);

    const count = await service.sweep(NOW);

    expect(count).toBe(0);
    expect(updates).toHaveLength(0);
    expect(events).toHaveLength(0);
  });

  it("exactly at end + grace is retained", async () => {
    const boundary = row({
      id: "s1",
      scheduledStartTime: new Date(
        NOW.getTime() - 60 * 60_000 - RETAINED_GRACE_MS,
      ),
      durationMinutes: 60,
    });
    const { service } = await makeService([[boundary]]);
    expect(await service.sweep(NOW)).toBe(1);
  });

  it("paginates by cursor across full batches", async () => {
    const big = Array.from({ length: 100 }, (_, i) => row({ id: `s${i}` }));
    const rest = [row({ id: "s100" })];
    const { service, findMany } = await makeService([big, rest]);

    const count = await service.sweep(NOW);

    expect(count).toBe(101);
    // Batch 2 is short (1 < 100) so the loop ends after it; the 2nd query
    // resumes from the cursor at the end of batch 1.
    expect(findMany).toHaveBeenCalledTimes(2);
    expect(findMany.mock.calls[1][0].cursor).toEqual({ id: "s99" });
  });

  it("a second run is a no-op (rows already filtered by retainedAt)", async () => {
    const { service } = await makeService([[]]);
    expect(await service.sweep(NOW)).toBe(0);
  });

  it("delivers a +1 LinUCB reward when a matching proposal exists", async () => {
    const { service, events, banditUpdate, armSave } = await makeService(
      [[row({ id: "s1" })]],
      {
        proposal: {
          id: "prop-1",
          selectedArm: "MORNING",
          featureVector: [0.1, 0.2, 0.3, -1, 0, 0.25, 1],
        },
      },
    );

    const count = await service.sweep(NOW);

    expect(count).toBe(1);
    expect(events[0].eventType).toBe("RETAINED");
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

  it("skips the bandit update when there is no LinUCB proposal", async () => {
    const { service, banditUpdate } = await makeService([[row({ id: "s1" })]]);
    await service.sweep(NOW);
    expect(banditUpdate).not.toHaveBeenCalled();
  });

  it("reinforces the user's preference matrix with the RETAINED weight (0.25) on the kept hour, regardless of policy (Item 3B3)", async () => {
    const { service, userUpdates } = await makeService([
      [
        row({
          id: "s1",
          scheduledStartTime: new Date("2026-06-15T09:00:00.000Z"), // Monday 09:00 UTC
          user: { timezone: "UTC" },
        }),
      ],
    ]);

    await service.sweep(NOW);

    expect(userUpdates).toHaveLength(1);
    expect(userUpdates[0].id).toBe("user-1");
    const written = userUpdates[0].data.preferenceMatrix as number[];
    // Monday (wd=1), hour 9 → matrixIndex(1, 9) = 9.
    expect(written[9]).toBeCloseTo(0.025); // PREFERENCE_LEARNING_RATE · PREFERENCE_RETAINED_WEIGHT
  });

  it("reinforces the preference matrix even when there is no LinUCB proposal for the session", async () => {
    const { service, userUpdates, banditUpdate } = await makeService([
      [row({ id: "s1" })],
    ]);

    await service.sweep(NOW);

    expect(banditUpdate).not.toHaveBeenCalled();
    expect(userUpdates).toHaveLength(1);
  });
});
