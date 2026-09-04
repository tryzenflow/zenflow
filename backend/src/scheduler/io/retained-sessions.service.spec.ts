/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
import { RetainedSessionsService } from "./retained-sessions.service";
import { RETAINED_GRACE_MS } from "../../common/constants";

interface Row {
  id: string;
  userId: string;
  type: string;
  scheduledStartTime: Date | null;
  durationMinutes: number;
  tags: { name: string }[];
}

const NOW = new Date("2026-06-15T12:00:00.000Z");

function row(over: Partial<Row> & { id: string }): Row {
  return {
    userId: "user-1",
    type: "TASK",
    scheduledStartTime: new Date("2026-06-15T08:00:00.000Z"),
    durationMinutes: 60,
    tags: [],
    ...over,
  };
}

function makeService(
  batches: Row[][],
  opts: { proposal?: Record<string, unknown> | null } = {},
) {
  const updates: { id: string; data: Record<string, unknown> }[] = [];
  const events: Record<string, unknown>[] = [];

  const findMany = jest.fn();
  batches.forEach((b) => findMany.mockResolvedValueOnce(b));
  findMany.mockResolvedValue([]);

  let eventSeq = 0;
  const tx = {
    session: {
      update: jest.fn(
        (args: { where: { id: string }; data: Record<string, unknown> }) => {
          updates.push({ id: args.where.id, data: args.data });
          return Promise.resolve({});
        },
      ),
    },
    sessionEvent: {
      create: jest.fn((args: { data: Record<string, unknown> }) => {
        events.push(args.data);
        return Promise.resolve({ id: BigInt(++eventSeq) });
      }),
    },
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

  return {
    service: new RetainedSessionsService(
      prisma as never,
      bandit as never,
      armStates as never,
    ),
    findMany,
    updates,
    events,
    banditUpdate,
    armSave,
  };
}

describe("RetainedSessionsService.sweep", () => {
  it("marks an elapsed, never-moved TASK as retained with a positive reward", async () => {
    const { service, updates, events } = makeService([[row({ id: "s1" })]]);

    const count = await service.sweep(NOW);

    expect(count).toBe(1);
    expect(updates).toEqual([{ id: "s1", data: { retainedAt: NOW } }]);
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe("RETAINED");
    expect(events[0].rewardScore).toBeGreaterThan(0);
    expect(events[0].sessionId).toBe("s1");
  });

  it("skips a session whose end + grace has not yet passed", async () => {
    const notElapsed = row({
      id: "s1",
      // ends at 11:59, +15m grace → 12:14, still in the future vs NOW 12:00
      scheduledStartTime: new Date("2026-06-15T10:59:00.000Z"),
      durationMinutes: 60,
    });
    const { service, updates, events } = makeService([[notElapsed]]);

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
    const { service } = makeService([[boundary]]);
    expect(await service.sweep(NOW)).toBe(1);
  });

  it("paginates by cursor across full batches", async () => {
    const big = Array.from({ length: 100 }, (_, i) => row({ id: `s${i}` }));
    const rest = [row({ id: "s100" })];
    const { service, findMany } = makeService([big, rest]);

    const count = await service.sweep(NOW);

    expect(count).toBe(101);
    // Batch 2 is short (1 < 100) so the loop ends after it; the 2nd query
    // resumes from the cursor at the end of batch 1.
    expect(findMany).toHaveBeenCalledTimes(2);
    expect(findMany.mock.calls[1][0].cursor).toEqual({ id: "s99" });
  });

  it("a second run is a no-op (rows already filtered by retainedAt)", async () => {
    const { service } = makeService([[]]);
    expect(await service.sweep(NOW)).toBe(0);
  });

  it("delivers a +1 LinUCB reward when a matching proposal exists", async () => {
    const { service, events, banditUpdate, armSave } = makeService(
      [[row({ id: "s1" })]],
      {
        proposal: {
          id: "prop-1",
          selectedArm: "MORNING",
          featureVector: [0.1, 0.2],
        },
      },
    );

    const count = await service.sweep(NOW);

    expect(count).toBe(1);
    expect(events[0].eventType).toBe("RETAINED");
    expect(banditUpdate).toHaveBeenCalledTimes(1);
    const [arm, x, reward] = banditUpdate.mock.calls[0];
    expect(arm).toBe("MORNING");
    expect(x).toEqual([0.1, 0.2]);
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
    const { service, banditUpdate } = makeService([[row({ id: "s1" })]]);
    await service.sweep(NOW);
    expect(banditUpdate).not.toHaveBeenCalled();
  });
});
