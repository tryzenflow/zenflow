import { UnrecoverableError, type Job, type Queue } from "bullmq";
import type Redis from "ioredis";
import {
  createWorker,
  isFinalFailure,
  moveToDeadLetter,
  watchStalledFailures,
} from "./create-worker";
import { defineQueue } from "./queue.types";

type Handlers = Record<string, (...args: unknown[]) => void>;
const created: { name: string; opts: Record<string, unknown>; on: Handlers }[] =
  [];

const eventHandlers: Handlers[] = [];

jest.mock("bullmq", () => ({
  ...jest.requireActual<object>("bullmq"),
  QueueEvents: jest.fn(function () {
    const on: Handlers = {};
    eventHandlers.push(on);
    return {
      on: (event: string, fn: (...a: unknown[]) => void) => {
        on[event] = fn;
      },
    };
  }),
  Worker: jest.fn(function (
    this: unknown,
    name: string,
    _processor: unknown,
    opts: Record<string, unknown>,
  ) {
    const on: Handlers = {};
    created.push({ name, opts, on });
    return {
      on: (event: string, fn: (...a: unknown[]) => void) => {
        on[event] = fn;
      },
    };
  }),
}));

const def = defineQueue<{ x: number }>({
  name: "demo",
  concurrency: 3,
  limiter: { max: 2, duration: 1000 },
});

const job = (over: Partial<Job> = {}) =>
  ({
    id: "j1",
    name: "demo",
    data: { x: 1 },
    attemptsMade: 1,
    opts: { attempts: 3 },
    stacktrace: ["at x"],
    timestamp: Date.now(),
    ...over,
  }) as unknown as Job;

const flush = () => new Promise((r) => setImmediate(r));

describe("createWorker", () => {
  let dlq: { add: jest.Mock };
  beforeEach(() => {
    created.length = 0;
    dlq = { add: jest.fn().mockResolvedValue({}) };
  });
  const make = (extra: object = {}) =>
    createWorker({
      def,
      processor: () => Promise.resolve(),
      connection: {} as Redis,
      dlq: dlq as unknown as Queue,
      ...extra,
    });

  it("uses the queue's concurrency and limiter by default, and lets callers override", () => {
    make();
    expect(created[0].opts).toMatchObject({
      concurrency: 3,
      limiter: { max: 2, duration: 1000 },
    });
    make({ concurrency: 9, limiter: { max: 1, duration: 5 } });
    expect(created[1].opts).toMatchObject({
      concurrency: 9,
      limiter: { max: 1, duration: 5 },
    });
  });

  it("does not dead-letter a failure that will be retried", async () => {
    make();
    created[0].on.failed(job({ attemptsMade: 2 }), new Error("x"));
    await flush();
    expect(dlq.add).not.toHaveBeenCalled();
  });

  it("dead-letters the final failure with payload and error", async () => {
    make();
    created[0].on.failed(job({ attemptsMade: 3 }), new Error("upstream 500"));
    await flush();
    expect(dlq.add).toHaveBeenCalledWith(
      "demo.dlq",
      expect.objectContaining({
        queue: "demo",
        jobId: "j1",
        data: { x: 1 },
        failedReason: "upstream 500",
        attemptsMade: 3,
        stacktrace: ["at x"],
      }),
      expect.objectContaining({
        jobId: expect.stringMatching(/^j1_\d+$/) as unknown,
        removeOnFail: expect.objectContaining({
          age: expect.any(Number) as unknown,
        }) as unknown,
      }),
    );
  });

  it("dead-letters an UnrecoverableError immediately", async () => {
    make();
    created[0].on.failed(
      job({ attemptsMade: 1 }),
      new UnrecoverableError("bad payload"),
    );
    await flush();
    expect(dlq.add).toHaveBeenCalledTimes(1);
  });

  it("survives a failing DLQ write and a stalled job without a payload", async () => {
    make();
    dlq.add.mockRejectedValue(new Error("redis"));
    created[0].on.failed(job({ attemptsMade: 3 }), new Error("x"));
    created[0].on.failed(undefined, new Error("stalled"));
    await flush();
    expect(dlq.add).toHaveBeenCalledTimes(1);
  });
});

describe("final-failure hook and stalled failures", () => {
  let dlq: { add: jest.Mock };
  beforeEach(() => {
    created.length = 0;
    dlq = { add: jest.fn().mockResolvedValue({}) };
  });
  const make = (extra: object = {}) =>
    createWorker({
      def,
      processor: () => Promise.resolve(),
      connection: {} as Redis,
      dlq: dlq as unknown as Queue,
      ...extra,
    });

  it("runs onFinalFailure after the DLQ write, and swallows its errors", async () => {
    const hook = jest.fn().mockRejectedValue(new Error("boom"));
    make({ onFinalFailure: hook });
    created[0].on.failed(job({ attemptsMade: 3 }), new Error("x"));
    await flush();
    expect(dlq.add).toHaveBeenCalledTimes(1);
    expect(hook).toHaveBeenCalledWith(
      expect.objectContaining({ id: "j1" }),
      expect.any(Error),
    );
  });

  it("does not run the hook for a retried failure", async () => {
    const hook = jest.fn();
    make({ onFinalFailure: hook });
    created[0].on.failed(job({ attemptsMade: 1 }), new Error("x"));
    await flush();
    expect(hook).not.toHaveBeenCalled();
  });

  it("uses finishedOn so replicas derive the same DLQ id for one failure", async () => {
    await moveToDeadLetter(
      dlq as unknown as Queue,
      def,
      job({ finishedOn: 1234 }),
      new Error("x"),
    );
    expect((dlq.add.mock.calls[0] as unknown[])[2]).toMatchObject({
      jobId: "j1_1234",
    });
  });

  it("dead-letters a job BullMQ failed as stalled, then runs the hook", async () => {
    const hook = jest.fn();
    const getJob = jest.fn().mockResolvedValue(job({ finishedOn: 5 }));
    watchStalledFailures({
      def,
      connection: { duplicate: () => ({}) } as unknown as Redis,
      queue: { getJob } as unknown as Queue,
      dlq: dlq as unknown as Queue,
      onFinalFailure: hook,
    });
    const events = eventHandlers[eventHandlers.length - 1];
    events.failed({
      jobId: "j1",
      failedReason: "job stalled more than allowable limit",
    });
    events.failed({ jobId: "j2", failedReason: "other" });
    await flush();
    expect(getJob).toHaveBeenCalledTimes(1);
    expect(dlq.add).toHaveBeenCalledTimes(1);
    expect(hook).toHaveBeenCalledTimes(1);
  });
});

describe("isFinalFailure / moveToDeadLetter", () => {
  it("defaults to a single attempt", () => {
    expect(
      isFinalFailure(job({ opts: {}, attemptsMade: 1 }), new Error("x")),
    ).toBe(true);
  });

  it("omits the job id when the job has none", async () => {
    const dlq = { add: jest.fn().mockResolvedValue({}) };
    await moveToDeadLetter(
      dlq as unknown as Queue,
      def,
      job({ id: undefined }),
      new Error("x"),
    );
    expect((dlq.add.mock.calls[0] as unknown[])[2]).not.toHaveProperty("jobId");
  });
});
