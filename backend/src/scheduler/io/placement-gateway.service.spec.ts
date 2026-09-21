import type { PlaceResponse } from "@zenflow/shared";
import type { User } from "../../../generated/prisma";
import { PlacementGateway } from "./placement-gateway.service";

const user = {
  id: "u1",
  timezone: "UTC",
  preferenceMatrix: [] as number[],
} as unknown as User;
const now = new Date("2026-06-08T08:00:00.000Z");
const deadline = new Date("2026-06-09T00:00:00.000Z");
const task = { id: "t1", durationMinutes: 60, deadline };

const respond = (outcome: string): PlaceResponse =>
  ({
    contractVersion: 1,
    requestId: "r",
    paramsVersion: "pv",
    results: [{ id: "t1", outcome }],
    timingsMs: {
      decode: 1,
      context: 1,
      predict: 1,
      scan: 1,
      displace: 1,
      total: 5,
    },
  }) as unknown as PlaceResponse;

function make(place: jest.Mock) {
  const prisma = {
    session: { findMany: jest.fn().mockResolvedValue([]) },
    sessionSeries: { findMany: jest.fn().mockResolvedValue([]) },
    sessionEvent: { count: jest.fn().mockResolvedValue(7) },
  };
  const loadAll = jest
    .fn()
    .mockResolvedValue(
      Object.fromEntries(
        ["EARLY_MORNING", "MORNING", "AFTERNOON", "EVENING", "NIGHT"].map(
          (a) => [a, { A: [], b: [], version: 0 }],
        ),
      ),
    );
  const gw = new PlacementGateway(
    prisma as never,
    { place, enabled: true } as never,
    { loadAll } as never,
  );
  return { gw, prisma, loadAll };
}

const member = (over = {}) => ({
  id: "t1",
  durationMinutes: 60,
  primaryPolicy: "HEURISTIC" as const,
  computeBoth: false,
  ...over,
});

describe("PlacementGateway.buildRequest", () => {
  const base = {
    user,
    deadline,
    now,
    mode: "PLACE" as const,
    maxScanDays: 30,
    excludeSessionIds: ["t1"],
  };

  it("buckets days, sends the observation count, and omits bandit state for heuristic-only", async () => {
    const { gw, loadAll } = make(jest.fn());
    const req = await gw.buildRequest({ ...base, members: [member()] });
    expect(req.contractVersion).toBe(1);
    expect(req.days.map((d) => d.dayStr)).toEqual(["2026-06-08"]);
    expect(req.user.observationCount).toBe(7);
    expect(req.bandit).toBeUndefined();
    expect(loadAll).not.toHaveBeenCalled();
    expect(req.requestId).toMatch(/[0-9a-f-]{36}/);
  });

  it("attaches alpha/ridge and per-arm state when LINUCB may run", async () => {
    const { gw, loadAll } = make(jest.fn());
    const req = await gw.buildRequest({
      ...base,
      members: [member({ primaryPolicy: "LINUCB", computeBoth: true })],
    });
    expect(loadAll).toHaveBeenCalledWith("u1");
    expect(Object.keys(req.bandit?.state ?? {}).sort()).toEqual(
      ["AFTERNOON", "EARLY_MORNING", "EVENING", "MORNING", "NIGHT"].sort(),
    );
    expect(req.bandit?.alpha).toBeGreaterThan(0);
  });

  it("caps the scan at maxScanDays and yields no days once the deadline has passed", async () => {
    const { gw } = make(jest.fn());
    const far = new Date("2026-12-31T00:00:00.000Z");
    const long = await gw.buildRequest({
      ...base,
      deadline: far,
      maxScanDays: 5,
      members: [member()],
    });
    expect(long.days).toHaveLength(5);
    const past = await gw.buildRequest({
      ...base,
      deadline: new Date(now.getTime() - 1),
      members: [member()],
    });
    expect(past.days).toEqual([]);
  });
});

describe("PlacementGateway.placeSingleTwoPhase", () => {
  const req = {
    requestId: "r",
    nowMs: now.getTime(),
    members: [member()],
  } as never;

  it("one call when Python places", async () => {
    const place = jest
      .fn()
      .mockResolvedValue({ ok: true, response: respond("PLACED") });
    const { gw } = make(place);
    const res = await gw.placeSingleTwoPhase(req, user, task, undefined);
    expect(res.ok).toBe(true);
    expect(place).toHaveBeenCalledTimes(1);
  });

  it("NEEDS_INFEASIBLE_CONTEXT triggers a second call with `infeasible` and a -2 id", async () => {
    const place = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        response: respond("NEEDS_INFEASIBLE_CONTEXT"),
      })
      .mockResolvedValueOnce({ ok: true, response: respond("DISPLACED") });
    const { gw } = make(place);
    const res = await gw.placeSingleTwoPhase(
      req,
      user,
      task,
      "ACCEPT_LATE_DEADLINE",
    );
    expect(place).toHaveBeenCalledTimes(2);
    const second = (place.mock.calls as unknown[][])[1][0] as {
      requestId: string;
      infeasible: { policy: string; flexible: unknown[] };
    };
    expect(second.requestId).toBe("r-2");
    expect(second.infeasible.policy).toBe("ACCEPT_LATE_DEADLINE");
    expect(second.infeasible.flexible).toEqual([]);
    expect(res.ok && res.response.results[0].outcome).toBe("DISPLACED");
  });

  it("a failed first call is returned as-is (no infeasible-context load)", async () => {
    const place = jest.fn().mockResolvedValue({ ok: false, reason: "timeout" });
    const { gw, prisma } = make(place);
    const res = await gw.placeSingleTwoPhase(req, user, task, undefined);
    expect(res).toEqual({ ok: false, reason: "timeout" });
    expect(place).toHaveBeenCalledTimes(1);
    expect(prisma.session.findMany).not.toHaveBeenCalled();
  });
});
