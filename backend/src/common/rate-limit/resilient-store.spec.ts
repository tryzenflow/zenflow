import type { Algorithm } from "@limitkit/core";
import { CircuitBreaker } from "../circuit-breaker";
import { ResilientStore } from "./resilient-store";

const algo = {} as Algorithm<never>;
const REAL: {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
} = {
  allowed: false,
  limit: 3,
  remaining: 0,
  resetAt: 99,
};

describe("ResilientStore", () => {
  let t: number;
  let inner: { consume: jest.Mock };
  let warn: jest.Mock;
  let onFailOpen: jest.Mock;
  let breaker: CircuitBreaker;
  let store: ResilientStore;

  beforeEach(() => {
    t = 1_000;
    inner = { consume: jest.fn().mockResolvedValue(REAL) };
    warn = jest.fn();
    onFailOpen = jest.fn();
    breaker = new CircuitBreaker(() => t, {
      consecutiveFailures: 3,
      openMs: 1_000,
      maxOpenMs: 4_000,
    });
    store = new ResilientStore(inner, breaker, {
      timeoutMs: 20,
      now: () => t,
      onFailOpen,
      logger: { warn },
    });
  });

  it("passes the inner result through on success", async () => {
    await expect(store.consume("k", algo, 5, 2)).resolves.toBe(REAL);
    expect(inner.consume).toHaveBeenCalledWith("k", algo, 5, 2);
    expect(onFailOpen).not.toHaveBeenCalled();
  });

  it("fails open on timeout and counts a failure", async () => {
    inner.consume.mockReturnValue(new Promise(() => undefined));
    const res = await store.consume("k", algo, 5);
    expect(res).toMatchObject({ allowed: true, limit: 1, remaining: 1 });
    expect(onFailOpen).toHaveBeenCalledWith("timeout");
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("fails open on error and throttles warnings", async () => {
    inner.consume.mockRejectedValue(new Error("down"));
    await store.consume("k", algo, 5);
    await store.consume("k", algo, 5);
    expect(onFailOpen).toHaveBeenCalledWith("error");
    expect(warn).toHaveBeenCalledTimes(1);
    t += 31_000;
    await store.consume("k", algo, 5);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("opens after N failures, short-circuits, then a half-open probe closes it", async () => {
    inner.consume.mockRejectedValue(new Error("down"));
    for (let i = 0; i < 3; i++) await store.consume("k", algo, 5);
    expect(breaker.state).toBe("open");
    inner.consume.mockClear();

    const res = await store.consume("k", algo, 5);
    expect(res.allowed).toBe(true);
    expect(inner.consume).not.toHaveBeenCalled();
    expect(onFailOpen).toHaveBeenLastCalledWith("breaker_open");

    t += 1_000;
    expect(breaker.state).toBe("half_open");
    inner.consume.mockResolvedValue(REAL);
    await expect(store.consume("k", algo, 5)).resolves.toBe(REAL);
    expect(inner.consume).toHaveBeenCalledTimes(1);
    expect(breaker.state).toBe("closed");
  });
});
