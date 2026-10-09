/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { QueueService } from "./queue.service";
import { NOTIFY_QUEUE, PORTAL_FETCH_QUEUE } from "./queues";
import { QUEUE_REDIS, dlqName } from "./queue.constants";
import { defineQueue, idempotencyKey } from "./queue.types";

const add = jest.fn();
const remove = jest.fn();
const close = jest.fn().mockResolvedValue(undefined);
const getJobCounts = jest.fn();
const getJob = jest.fn();
const clean = jest.fn();
const queueNames: string[] = [];

jest.mock("bullmq", () => ({
  ...jest.requireActual<object>("bullmq"),
  Queue: jest.fn(function (this: unknown, name: string) {
    queueNames.push(name);
    return { add, remove, close, getJobCounts, getJob, clean, on: jest.fn() };
  }),
}));

const make = async (
  conn: unknown,
  cfg: Record<string, unknown> = {},
): Promise<QueueService> => {
  const moduleRef = await Test.createTestingModule({
    providers: [
      QueueService,
      { provide: QUEUE_REDIS, useValue: conn },
      { provide: ConfigService, useValue: new ConfigService(cfg) },
    ],
  }).compile();
  return moduleRef.get(QueueService);
};

describe("QueueService (Redis)", () => {
  const disconnect = jest.fn();
  const redis = { disconnect } as never;
  beforeEach(() => {
    jest.clearAllMocks();
    queueNames.length = 0;
    add.mockResolvedValue({ id: "x" });
  });

  it("enqueues with env-driven attempts, exponential backoff and the idempotent job id", async () => {
    const svc = await make(redis, {
      QUEUE_JOB_ATTEMPTS: 7,
      QUEUE_BACKOFF_MS: 1234,
    });
    await svc.enqueue(
      NOTIFY_QUEUE,
      { type: "push", notificationId: "n", provider: "fcm" },
      { jobId: "push_n_fcm" },
    );
    expect(add).toHaveBeenCalledWith(
      "notify",
      { type: "push", notificationId: "n", provider: "fcm" },
      expect.objectContaining({
        jobId: "push_n_fcm",
        attempts: 7,
        backoff: { type: "exponential", delay: 1234 },
      }),
    );
    expect((add.mock.calls[0] as unknown[][])[2]).not.toHaveProperty("delay");
  });

  it("adds a delay only when asked, and per-call options win", async () => {
    const svc = await make(redis);
    await svc.enqueue(
      NOTIFY_QUEUE,
      { type: "reminder", reminderId: "r", startsAt: "s" },
      { jobId: "j", delayMs: 1500.4, jobOptions: { attempts: 1 } },
    );
    expect(add.mock.calls[0][2]).toMatchObject({ delay: 1500, attempts: 1 });
  });

  it("reuses one Queue per name and exposes the <name>.dlq queue", async () => {
    const svc = await make(redis);
    svc.queue(PORTAL_FETCH_QUEUE);
    svc.queue(PORTAL_FETCH_QUEUE);
    svc.dlq(PORTAL_FETCH_QUEUE);
    expect(queueNames).toEqual(["portal-fetch", dlqName("portal-fetch")]);
  });

  it("enqueueBestEffort resolves null instead of hanging or throwing", async () => {
    const svc = await make(redis, { QUEUE_ENQUEUE_TIMEOUT_MS: 20 });
    add.mockReturnValueOnce(new Promise(() => undefined));
    await expect(
      svc.enqueueBestEffort(
        NOTIFY_QUEUE,
        { type: "push", notificationId: "n", provider: "fcm" },
        { jobId: "a" },
      ),
    ).resolves.toBeNull();
    add.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    await expect(
      svc.enqueueBestEffort(
        NOTIFY_QUEUE,
        { type: "push", notificationId: "n", provider: "fcm" },
        { jobId: "b" },
      ),
    ).resolves.toBeNull();
  });

  it("getJob, remove and counts reject or fall back fast instead of hanging when Redis is down", async () => {
    const svc = await make(redis, { QUEUE_ENQUEUE_TIMEOUT_MS: 20 });
    const hang = () => new Promise(() => undefined);
    add.mockReturnValueOnce(hang());
    await expect(
      svc.enqueue(
        NOTIFY_QUEUE,
        { type: "push", notificationId: "n", provider: "fcm" },
        { jobId: "a" },
      ),
    ).rejects.toThrow(/timed out/);
    getJob.mockReturnValueOnce(hang());
    await expect(svc.getJob(NOTIFY_QUEUE, "a")).rejects.toThrow(/timed out/);
    remove.mockReturnValueOnce(hang());
    await expect(svc.remove(NOTIFY_QUEUE, "a")).resolves.toBe(false);
    getJobCounts.mockReturnValue(hang());
    await expect(svc.counts(NOTIFY_QUEUE)).rejects.toThrow(/timed out/);
  });

  it("trimDlq cleans waiting dead letters older than the age", async () => {
    clean.mockResolvedValueOnce(["a", "b"]);
    const svc = await make(redis);
    await expect(svc.trimDlq(NOTIFY_QUEUE, 1000)).resolves.toBe(2);
    expect(clean).toHaveBeenCalledWith(1000, 1000, "wait");
  });

  it("counts include the DLQ size", async () => {
    getJobCounts
      .mockResolvedValueOnce({ waiting: 2, delayed: 1, active: 0, failed: 3 })
      .mockResolvedValueOnce({ waiting: 4 });
    const svc = await make(redis);
    await expect(svc.counts(NOTIFY_QUEUE)).resolves.toEqual({
      waiting: 2,
      delayed: 1,
      active: 0,
      failed: 3,
      dlq: 4,
    });
  });

  it("closes queues, then the connection, on application shutdown", async () => {
    const svc = await make(redis);
    svc.queue(NOTIFY_QUEUE);
    await svc.onApplicationShutdown();
    expect(close).toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalled();
  });

  it("remove returns false for an active/absent job instead of throwing", async () => {
    remove.mockRejectedValueOnce(new Error("locked"));
    const svc = await make(redis);
    await expect(svc.remove(NOTIFY_QUEUE, "j")).resolves.toBe(false);
    remove.mockResolvedValueOnce(1);
    await expect(svc.remove(NOTIFY_QUEUE, "j")).resolves.toBe(true);
  });
});

describe("QueueService (in-memory test fallback)", () => {
  let svc: QueueService;
  beforeAll(async () => {
    svc = await make(null);
  });

  it("records jobs and deduplicates by job id without touching Redis", async () => {
    expect(svc.memory).toBe(true);
    await svc.enqueue(
      NOTIFY_QUEUE,
      { type: "push", notificationId: "n", provider: "fcm" },
      { jobId: "push_n_fcm" },
    );
    const again = await svc.enqueue(
      NOTIFY_QUEUE,
      { type: "push", notificationId: "n", provider: "fcm" },
      { jobId: "push_n_fcm" },
    );
    expect(again.id).toBe("push_n_fcm");
    expect(svc.memoryJobs).toHaveLength(1);
    expect(await svc.counts(NOTIFY_QUEUE)).toMatchObject({ waiting: 1 });
    expect(await svc.remove(NOTIFY_QUEUE, "push_n_fcm")).toBe(true);
    expect(svc.memoryJobs).toHaveLength(0);
  });

  it("getJob finds a recorded job", async () => {
    await svc.enqueue(
      NOTIFY_QUEUE,
      { type: "push", notificationId: "g", provider: "apns" },
      { jobId: "push_g_apns" },
    );
    expect(await svc.getJob(NOTIFY_QUEUE, "push_g_apns")).toMatchObject({
      id: "push_g_apns",
    });
    expect(await svc.getJob(NOTIFY_QUEUE, "none")).toBeUndefined();
  });

  it("refuses to open a real queue", () => {
    expect(() => svc.queue(NOTIFY_QUEUE)).toThrow(/not configured/);
  });
});

describe("queue definitions", () => {
  it("rejects names BullMQ or the DLQ convention cannot take", () => {
    expect(() => defineQueue({ name: "a:b" })).toThrow();
    expect(() => defineQueue({ name: "x.dlq" })).toThrow();
  });

  it("idempotencyKey is stable, colon-free and date-aware", () => {
    const d = new Date("2026-01-01T00:00:00.000Z");
    expect(idempotencyKey("sched", "s1", d)).toBe(`sched_s1_${d.getTime()}`);
    expect(idempotencyKey("a:b", "c")).toBe("a-b_c");
  });
});
