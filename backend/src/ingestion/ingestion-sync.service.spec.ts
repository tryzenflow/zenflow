import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
// `IngestionSyncService` must be imported before the watchers: the
// IntegrationsModule <-> IngestionModule cycle makes the import order matter
// for `design:paramtypes` (see IngestionSyncService).
import {
  IngestionSyncService,
  ManualSyncUnavailableError,
} from "./ingestion-sync.service";
import { IngestionFetchService } from "./ingestion-fetch.service";
import { LMSService } from "../lms/lms.service";
import { PortalAPIService } from "../portal/portal-api.service";
import { QUEUE_REDIS } from "../queue/queue.constants";
import { QueueService } from "../queue/queue.service";
import { LMS_FETCH_QUEUE, PORTAL_FETCH_QUEUE } from "../queue/queues";

const NOW = new Date("2026-09-06T04:00:00.000Z");

const mockEvents = {
  on: jest.fn(),
  waitUntilReady: jest.fn(),
  close: jest.fn(),
};
// eslint-disable-next-line @typescript-eslint/no-unsafe-return
jest.mock("bullmq", () => ({
  ...jest.requireActual("bullmq"),
  QueueEvents: jest.fn().mockImplementation(() => mockEvents),
}));

type Wait = "ok" | "fail" | "timeout" | "timeout-failed" | "parked";

function fakeJob(id: string, wait: Wait) {
  return {
    id,
    delay: 30_000,
    processedOn: Date.now(),
    waitUntilFinished: jest.fn(() =>
      wait === "parked"
        ? new Promise<never>(() => undefined)
        : wait === "ok"
          ? Promise.resolve({ ok: true, servedFromCache: false })
          : wait === "fail"
            ? Promise.reject(new Error("boom"))
            : Promise.reject(new Error("timed out")),
    ),
    getState: jest
      .fn()
      .mockResolvedValue(
        wait === "fail" || wait === "timeout-failed"
          ? "failed"
          : wait === "parked"
            ? "delayed"
            : "active",
      ),
  };
}

async function makeService(
  opts: {
    waits?: { LMS: number | null; PORTAL: number | null };
    enabled?: boolean;
    memory?: boolean;
    integration?: boolean;
    waitFor?: Record<string, Wait>;
    execute?: jest.Mock;
    existingJob?: Record<string, unknown> | null;
    queueTimeoutMs?: number;
  } = {},
) {
  const waits = opts.waits ?? { LMS: null, PORTAL: null };
  const waitFor = opts.waitFor ?? {};
  const execute =
    opts.execute ??
    jest.fn().mockResolvedValue({ ok: true, servedFromCache: false });
  const recordExhausted = jest.fn().mockResolvedValue(undefined);
  const getJob = jest.fn().mockResolvedValue(opts.existingJob ?? null);
  const enqueue = jest.fn(
    (_def: unknown, data: { kind: string }, o: { jobId: string }) =>
      Promise.resolve(fakeJob(o.jobId, waitFor[data.kind] ?? "ok")),
  );
  const findUnique = jest
    .fn()
    .mockResolvedValue(opts.integration === false ? null : { id: "int1" });

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      IngestionSyncService,
      { provide: PrismaService, useValue: { integration: { findUnique } } },
      {
        provide: ConfigService,
        useValue: {
          get: (n: string) =>
            n === "INGESTION_ENABLED"
              ? (opts.enabled ?? true)
              : n === "QUEUE_ENQUEUE_TIMEOUT_MS"
                ? opts.queueTimeoutMs
                : undefined,
        },
      },
      {
        provide: QueueService,
        useValue: {
          memory: opts.memory ?? false,
          enqueue,
          getJob,
        },
      },
      {
        provide: IngestionFetchService,
        useValue: { execute, recordExhausted },
      },
      { provide: QUEUE_REDIS, useValue: opts.memory ? null : {} },
      { provide: LMSService, useValue: { unavailableFor: () => waits.LMS } },
      {
        provide: PortalAPIService,
        useValue: { unavailableFor: () => waits.PORTAL },
      },
    ],
  }).compile();
  return {
    service: module.get(IngestionSyncService),
    enqueue,
    execute,
    recordExhausted,
    getJob,
  };
}

describe("IngestionSyncService - queued", () => {
  it("enqueues the LMS pass on lms-fetch with a manual job id and waits for it", async () => {
    const s = await makeService();

    const outcome = await s.service.syncNow("u1", "LMS", NOW);

    expect(s.enqueue).toHaveBeenCalledTimes(1);
    expect(s.enqueue).toHaveBeenCalledWith(
      LMS_FETCH_QUEUE,
      expect.objectContaining({
        userId: "u1",
        integrationId: "int1",
        kind: "LMS_CALENDAR",
        manual: true,
      }),
      { jobId: "manual_int1_LMS_CALENDAR", jobOptions: { attempts: 1 } },
    );
    expect(outcome).toEqual({
      synced: ["LMS_CALENDAR"],
      complete: true,
      pending: false,
    });
  });

  it("queues both portal passes, timetable first", async () => {
    const s = await makeService();

    const outcome = await s.service.syncNow("u1", "PORTAL", NOW);

    expect(s.enqueue.mock.calls.map((c) => [c[0], c[1].kind])).toEqual([
      [PORTAL_FETCH_QUEUE, "PORTAL_TIMETABLE"],
      [PORTAL_FETCH_QUEUE, "PORTAL_EXAM"],
    ]);
    expect(outcome).toEqual({
      synced: ["PORTAL_DISCOVERY", "PORTAL_TIMETABLE", "PORTAL_EXAM"],
      complete: true,
      pending: false,
    });
  });

  it("marks the run incomplete, not pending, when a job failed", async () => {
    const s = await makeService({ waitFor: { PORTAL_TIMETABLE: "fail" } });

    expect(await s.service.syncNow("u1", "PORTAL", NOW)).toEqual({
      synced: ["PORTAL_EXAM"],
      complete: false,
      pending: false,
    });
  });

  it("reports pending when the wait expires while the job is still running", async () => {
    const s = await makeService({ waitFor: { PORTAL_EXAM: "timeout" } });

    expect(await s.service.syncNow("u1", "PORTAL", NOW)).toEqual({
      synced: ["PORTAL_DISCOVERY", "PORTAL_TIMETABLE"],
      complete: false,
      pending: true,
    });
  });

  it("treats a wait that expired on a job that has since failed as failed", async () => {
    const s = await makeService({
      waitFor: { LMS_CALENDAR: "timeout-failed" },
    });

    expect(await s.service.syncNow("u1", "LMS", NOW)).toMatchObject({
      complete: false,
      pending: false,
    });
  });

  it("failed beats pending when one job failed and another is still running", async () => {
    const s = await makeService({
      waitFor: { PORTAL_TIMETABLE: "fail", PORTAL_EXAM: "timeout" },
    });

    expect(await s.service.syncNow("u1", "PORTAL", NOW)).toMatchObject({
      complete: false,
      pending: false,
    });
  });

  it("replaces a finished manual job, but joins one still running", async () => {
    const finished = {
      getState: jest.fn().mockResolvedValue("completed"),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    const a = await makeService({ existingJob: finished });
    await a.service.syncNow("u1", "LMS", NOW);
    expect(finished.remove).toHaveBeenCalled();

    const active = {
      getState: jest.fn().mockResolvedValue("active"),
      remove: jest.fn(),
    };
    const b = await makeService({ existingJob: active });
    await b.service.syncNow("u1", "LMS", NOW);
    expect(active.remove).not.toHaveBeenCalled();
  });

  it("fails fast with a retry hint when the queue is unreachable", async () => {
    const s = await makeService();
    s.enqueue.mockImplementation(() =>
      Promise.reject(new Error("enqueue timed out after 20ms")),
    );

    const err = await s.service
      .syncNow("u1", "LMS", NOW)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ManualSyncUnavailableError);
    expect((err as ManualSyncUnavailableError).reason).toBe("queue");
  });

  it("503s instead of waiting when a repeat press finds its job parked", async () => {
    const parked = {
      getState: jest.fn().mockResolvedValue("delayed"),
      remove: jest.fn(),
      delay: 45_000,
      processedOn: Date.now(),
    };
    const s = await makeService({ existingJob: parked });

    const err = await s.service
      .syncNow("u1", "LMS", NOW)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ManualSyncUnavailableError);
    expect((err as ManualSyncUnavailableError).retryAfterMs).toBeGreaterThan(
      40_000,
    );
    expect(s.enqueue).not.toHaveBeenCalled();
  });

  it("503s while waiting once the worker parks the job behind the breaker", async () => {
    const s = await makeService({ waitFor: { LMS_CALENDAR: "parked" } });

    const err = await s.service
      .syncNow("u1", "LMS", NOW)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ManualSyncUnavailableError);
    expect((err as ManualSyncUnavailableError).reason).toBe("upstream");
  }, 10_000);

  it("does nothing when ingestion is switched off", async () => {
    const s = await makeService({ enabled: false });

    expect(await s.service.syncNow("u1", "LMS", NOW)).toEqual({
      synced: [],
      complete: false,
      pending: false,
    });
    expect(s.enqueue).not.toHaveBeenCalled();
  });

  it("does nothing for a provider that is not connected", async () => {
    const s = await makeService({ integration: false });

    expect(await s.service.syncNow("u1", "LMS", NOW)).toMatchObject({
      complete: false,
    });
    expect(s.enqueue).not.toHaveBeenCalled();
  });

  it("reports each provider's breaker wait, null when closed", async () => {
    const s = await makeService({ waits: { LMS: 42_000, PORTAL: null } });

    expect(s.service.upstreamUnavailableFor("LMS")).toBe(42_000);
    expect(s.service.upstreamUnavailableFor("PORTAL")).toBeNull();
  });
});

describe("IngestionSyncService - without a queue Redis", () => {
  it("runs the passes inline, one after the other", async () => {
    const order: string[] = [];
    const execute = jest.fn((d: { kind: string }) => {
      order.push(d.kind);
      return Promise.resolve({ ok: true, servedFromCache: false });
    });
    const s = await makeService({ memory: true, execute });

    const outcome = await s.service.syncNow("u1", "PORTAL", NOW);

    expect(order).toEqual(["PORTAL_TIMETABLE", "PORTAL_EXAM"]);
    expect(s.enqueue).not.toHaveBeenCalled();
    expect(outcome.complete).toBe(true);
  });

  it("records a thrown pass as exhausted and reports the run incomplete", async () => {
    const execute = jest.fn().mockRejectedValue(new Error("no token"));
    const s = await makeService({ memory: true, execute });

    expect(await s.service.syncNow("u1", "LMS", NOW)).toEqual({
      synced: [],
      complete: false,
      pending: false,
    });
    expect(s.recordExhausted).toHaveBeenCalledTimes(1);
  });
});
