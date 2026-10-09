/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { QueueWorkers, queueEnvKey } from "./queue-workers.service";
import { QueueService } from "./queue.service";
import { QUEUE_REDIS } from "./queue.constants";
import { LMS_FETCH_QUEUE, NOTIFY_QUEUE } from "./queues";
import * as createWorkerModule from "./create-worker";

describe("QueueWorkers", () => {
  const close = jest.fn();
  const eventsClose = jest.fn().mockResolvedValue(undefined);
  let spy: jest.SpyInstance;
  let watch: jest.SpyInstance;
  const queues = {
    dlq: jest.fn().mockReturnValue({ name: "dlq" }),
    queue: jest.fn().mockReturnValue({ name: "q" }),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    close.mockResolvedValue(undefined);
    spy = jest
      .spyOn(createWorkerModule, "createWorker")
      .mockReturnValue({ close } as never);
    watch = jest
      .spyOn(createWorkerModule, "watchStalledFailures")
      .mockReturnValue({ close: eventsClose } as never);
  });
  afterEach(() => {
    spy.mockRestore();
    watch.mockRestore();
  });

  const make = async (
    cfg: Record<string, unknown> = {},
    conn: unknown = {},
  ) => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        QueueWorkers,
        { provide: QUEUE_REDIS, useValue: conn },
        { provide: QueueService, useValue: queues },
        { provide: ConfigService, useValue: new ConfigService(cfg) },
      ],
    }).compile();
    return moduleRef.get(QueueWorkers);
  };

  it("maps queue names to env keys", () => {
    expect(queueEnvKey("lms-fetch")).toBe("LMS_FETCH");
  });

  it("starts nothing without a queue Redis (test fallback)", async () => {
    const w = await make({}, null);
    expect(w.register(NOTIFY_QUEUE, () => Promise.resolve())).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("reads concurrency and rate limit from QUEUE_<NAME>_* env", async () => {
    (
      await make({
        QUEUE_LMS_FETCH_CONCURRENCY: 2,
        QUEUE_LMS_FETCH_RATE_MAX: 1,
        QUEUE_LMS_FETCH_RATE_DURATION_MS: 750,
      })
    ).register(LMS_FETCH_QUEUE, () => Promise.resolve());
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        concurrency: 2,
        limiter: { max: 1, duration: 750 },
      }),
    );
  });

  it("falls back to the queue definition when env is unset, and explicit options win", async () => {
    const w = await make();
    w.register(NOTIFY_QUEUE, () => Promise.resolve());
    expect(spy.mock.calls[0][0]).toMatchObject({
      concurrency: undefined,
      limiter: undefined,
    });
    w.register(NOTIFY_QUEUE, () => Promise.resolve(), { concurrency: 4 });
    expect(spy.mock.calls[1][0]).toMatchObject({ concurrency: 4 });
  });

  it("passes onFinalFailure to the worker and the stalled watcher", async () => {
    const hook = jest.fn();
    const w = await make();
    w.register(LMS_FETCH_QUEUE, () => Promise.resolve(), {
      onFinalFailure: hook,
    });
    expect(spy.mock.calls[0][0]).toMatchObject({ onFinalFailure: hook });
    expect(watch.mock.calls[0][0]).toMatchObject({ onFinalFailure: hook });
  });

  it("drains every worker and stalled watcher before shutdown", async () => {
    const w = await make();
    w.register(NOTIFY_QUEUE, () => Promise.resolve());
    w.register(LMS_FETCH_QUEUE, () => Promise.resolve());
    await w.beforeApplicationShutdown();
    expect(close).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledWith();
    expect(eventsClose).toHaveBeenCalledTimes(2);
  });

  it("force-closes workers still busy after QUEUE_SHUTDOWN_TIMEOUT_MS", async () => {
    close.mockImplementation((force?: boolean) =>
      force ? Promise.resolve() : new Promise(() => undefined),
    );
    const w = await make({ QUEUE_SHUTDOWN_TIMEOUT_MS: 20 });
    w.register(NOTIFY_QUEUE, () => Promise.resolve());
    await w.beforeApplicationShutdown();
    expect(close).toHaveBeenCalledWith(true);
  });
});
