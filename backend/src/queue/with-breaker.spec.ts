import { ConfigService } from "@nestjs/config";
import { DelayedError, type Job } from "bullmq";
import {
  OutboundBreakers,
  UpstreamUnavailableError,
} from "../common/outbound-breaker";
import { withBreaker } from "./with-breaker";

function setup(failures = 2) {
  let now = 1_000_000;
  const breakers = new OutboundBreakers(
    new ConfigService({
      INGESTION_BREAKER_FAILURES: failures,
      INGESTION_BREAKER_OPEN_MS: 60_000,
      INGESTION_BREAKER_MAX_OPEN_MS: 600_000,
    }),
    () => now,
  );
  const job = (over: Partial<Job> = {}) =>
    ({
      queueName: "portal-fetch",
      attemptsStarted: 1,
      attemptsMade: 0,
      moveToDelayed: jest.fn().mockResolvedValue(undefined),
      ...over,
    }) as unknown as Job & { moveToDelayed: jest.Mock };
  return { breakers, job, advance: (ms: number) => (now += ms) };
}

const boom = () => Promise.reject(new Error("503"));

describe("withBreaker", () => {
  it("returns the value while the breaker is closed", async () => {
    const { breakers, job } = setup();
    await expect(
      withBreaker(breakers, "dlu-portal", job(), "t", () =>
        Promise.resolve(42),
      ),
    ).resolves.toBe(42);
  });

  it("rethrows an ordinary failure unchanged (BullMQ backoff applies) and never delays", async () => {
    const { breakers, job } = setup(5);
    const j = job();
    await expect(
      withBreaker(breakers, "dlu-portal", j, "t", boom),
    ).rejects.toThrow("503");
    expect(j.moveToDelayed).not.toHaveBeenCalled();
  });

  it("open breaker: makes no request, moves the job to delayed and throws DelayedError", async () => {
    const { breakers, job } = setup(1);
    await expect(
      withBreaker(breakers, "dlu-portal", job(), "t", boom),
    ).rejects.toThrow("503"); // trips the breaker
    const fn = jest.fn(() => Promise.resolve(1));
    const j = job();
    const before = Date.now();

    await expect(
      withBreaker(breakers, "dlu-portal", j, "tok", fn, { random: () => 0 }),
    ).rejects.toBeInstanceOf(DelayedError);

    expect(fn).not.toHaveBeenCalled();
    expect(j.moveToDelayed).toHaveBeenCalledTimes(1);
    const [at, token] = j.moveToDelayed.mock.calls[0] as [number, string];
    expect(token).toBe("tok");
    expect(at - before).toBeGreaterThanOrEqual(59_000);
    expect(at - before).toBeLessThanOrEqual(61_000);
  });

  it("adds up to 10% jitter to the delay", async () => {
    const { breakers, job } = setup(1);
    await withBreaker(breakers, "dlu-lms", job(), "t", boom).catch(() => 0);
    const j = job();
    const before = Date.now();
    await withBreaker(breakers, "dlu-lms", j, "t", boom, {
      random: () => 0.999,
    }).catch(() => 0);
    const at = (j.moveToDelayed.mock.calls[0] as [number])[0];
    expect(at - before).toBeGreaterThan(65_000);
    expect(at - before).toBeLessThanOrEqual(66_100);
  });

  it("stops parking after maxDelays and surfaces the error so attempts are used", async () => {
    const { breakers, job } = setup(1);
    await withBreaker(breakers, "dlu-lms", job(), "t", boom).catch(() => 0);
    // started 4 times, 1 real attempt -> parked twice already (4 - 1 - 1)
    const j = job({ attemptsStarted: 4, attemptsMade: 1 });
    await expect(
      withBreaker(breakers, "dlu-lms", j, "t", boom, { maxDelays: 2 }),
    ).rejects.toBeInstanceOf(UpstreamUnavailableError);
    expect(j.moveToDelayed).not.toHaveBeenCalled();
  });

  it("breakers are per upstream", async () => {
    const { breakers, job } = setup(1);
    await withBreaker(breakers, "fcm", job(), "t", boom).catch(() => 0);
    await expect(
      withBreaker(breakers, "apns", job(), "t", () => Promise.resolve("ok")),
    ).resolves.toBe("ok");
  });

  it("probes again once the open time has passed", async () => {
    const { breakers, job, advance } = setup(1);
    await withBreaker(breakers, "fcm", job(), "t", boom).catch(() => 0);
    advance(61_000);
    await expect(
      withBreaker(breakers, "fcm", job(), "t", () => Promise.resolve("ok")),
    ).resolves.toBe("ok");
  });
});
