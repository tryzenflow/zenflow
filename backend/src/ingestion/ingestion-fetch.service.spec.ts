// Imported first: the IntegrationsModule <-> IngestionModule cycle makes the
// import order matter for `design:paramtypes` (see ingestion-sync.service.spec).
import "./ingestion-sync.service";
import { KillSwitchService } from "../common/killswitch/killswitch.service";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { LMSService } from "../lms/lms.service";
import { PortalAPIService } from "../portal/portal-api.service";
import { EnrollmentDiscoveryService } from "./enrollment-discovery.service";
import { ExamWatcherService } from "./exam-watcher.service";
import { IngestionScheduleService } from "./ingestion-schedule.service";
import { LmsWatcherService } from "./lms-watcher.service";
import { TimetableWatcherService } from "./timetable-watcher.service";
import { DelayedError, type Job } from "bullmq";
import { UpstreamUnavailableError } from "../common/outbound-breaker";
import type { FetchJobData } from "../queue/queues";
import { IngestionFetchService } from "./ingestion-fetch.service";

const OK = { ok: true, servedFromCache: false };

const data = (over: Partial<FetchJobData> = {}): FetchJobData => ({
  scheduleId: "sch1",
  userId: "u1",
  integrationId: "int1",
  kind: "PORTAL_TIMETABLE",
  dueAt: "2026-10-26T02:00:00.000Z",
  claimedAt: "2026-10-26T03:00:00.000Z",
  cacheHitStreak: 2,
  ...over,
});

function job(d: FetchJobData, over: Partial<Job> = {}) {
  return {
    data: d,
    queueName: "portal-fetch",
    attemptsStarted: 1,
    attemptsMade: 0,
    opts: { attempts: 5 },
    moveToDelayed: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
    ...over,
  } as unknown as Job<FetchJobData> & {
    moveToDelayed: jest.Mock;
    remove: jest.Mock;
  };
}

async function make(
  env: Record<string, unknown> = {},
  waits: { LMS: number | null; PORTAL: number | null } = {
    LMS: null,
    PORTAL: null,
  },
) {
  const schedule = {
    recordOutcome: jest.fn().mockResolvedValue(undefined),
    deferAfterManualSync: jest.fn().mockResolvedValue(undefined),
    markManualFailure: jest.fn().mockResolvedValue(undefined),
    releaseClaim: jest.fn().mockResolvedValue(undefined),
  };
  const timetable = { syncOne: jest.fn().mockResolvedValue(OK) };
  const exam = { syncOne: jest.fn().mockResolvedValue(OK) };
  const lms = { syncOne: jest.fn().mockResolvedValue(OK) };
  const discovery = {
    syncPortal: jest.fn().mockResolvedValue(OK),
    syncLms: jest.fn().mockResolvedValue(OK),
  };
  const module = await Test.createTestingModule({
    providers: [
      {
        provide: KillSwitchService,
        useValue: { isEnabled: jest.fn().mockResolvedValue(true) },
      },
      IngestionFetchService,
      {
        provide: ConfigService,
        useValue: new ConfigService({ INGESTION_ENABLED: true, ...env }),
      },
      { provide: IngestionScheduleService, useValue: schedule },
      { provide: TimetableWatcherService, useValue: timetable },
      { provide: ExamWatcherService, useValue: exam },
      { provide: LmsWatcherService, useValue: lms },
      { provide: EnrollmentDiscoveryService, useValue: discovery },
      { provide: LMSService, useValue: { unavailableFor: () => waits.LMS } },
      {
        provide: PortalAPIService,
        useValue: { unavailableFor: () => waits.PORTAL },
      },
    ],
  }).compile();
  const service = module.get(IngestionFetchService);
  return { service, schedule, timetable, exam, lms, discovery };
}

describe("IngestionFetchService", () => {
  it("routes each kind to its own pass with the claimed target", async () => {
    const m = await make();
    const kinds = [
      "PORTAL_TIMETABLE",
      "PORTAL_EXAM",
      "LMS_CALENDAR",
      "PORTAL_DISCOVERY",
      "LMS_DISCOVERY",
    ];
    for (const kind of kinds) await m.service.execute(data({ kind }));

    const target: unknown = expect.objectContaining({
      integrationId: "int1",
      userId: "u1",
      scheduleId: "sch1",
      cacheHitStreak: 2,
      dueAt: new Date("2026-10-26T02:00:00.000Z"),
      claimedAt: new Date("2026-10-26T03:00:00.000Z"),
    });
    expect(m.timetable.syncOne).toHaveBeenCalledWith(target, expect.any(Date));
    expect(m.exam.syncOne).toHaveBeenCalledTimes(1);
    expect(m.lms.syncOne).toHaveBeenCalledTimes(1);
    expect(m.discovery.syncPortal).toHaveBeenCalledTimes(1);
    expect(m.discovery.syncLms).toHaveBeenCalledTimes(1);
  });

  it("records the outcome once, on the schedule row", async () => {
    const m = await make();
    m.exam.syncOne.mockResolvedValue({ ok: false, servedFromCache: false });

    const res = await m.service.execute(data({ kind: "PORTAL_EXAM" }));

    expect(res).toEqual({ ok: false, servedFromCache: false });
    expect(m.schedule.recordOutcome).toHaveBeenCalledTimes(1);
    expect(m.schedule.recordOutcome).toHaveBeenCalledWith("sch1", {
      ok: false,
      servedFromCache: false,
      now: expect.any(Date) as Date,
    });
  });

  it("survives a failure to record the outcome", async () => {
    const m = await make();
    m.schedule.recordOutcome.mockRejectedValue(new Error("db"));

    await expect(m.service.execute(data())).resolves.toEqual(OK);
  });

  it("skips everything when ingestion is switched off", async () => {
    const m = await make({ INGESTION_ENABLED: false });

    expect(await m.service.execute(data())).toMatchObject({ skipped: true });
    expect(m.timetable.syncOne).not.toHaveBeenCalled();
    expect(m.schedule.recordOutcome).not.toHaveBeenCalled();
  });

  it("makes no request while the breaker is open", async () => {
    const m = await make({}, { LMS: null, PORTAL: 30_000 });

    await expect(m.service.execute(data())).rejects.toBeInstanceOf(
      UpstreamUnavailableError,
    );
    expect(m.timetable.syncOne).not.toHaveBeenCalled();
  });

  it("treats a partial walk cut short by the breaker as unavailable, not recorded", async () => {
    const m = await make();
    m.timetable.syncOne.mockResolvedValue({
      ok: false,
      servedFromCache: false,
      upstreamDown: new UpstreamUnavailableError("dlu-portal", 5_000),
    });

    await expect(m.service.execute(data())).rejects.toBeInstanceOf(
      UpstreamUnavailableError,
    );
    expect(m.schedule.recordOutcome).not.toHaveBeenCalled();
  });

  describe("handle", () => {
    it("parks the job without using an attempt when the breaker is open", async () => {
      const m = await make({}, { LMS: null, PORTAL: 30_000 });
      const j = job(data());

      await expect(m.service.handle(j, "tok")).rejects.toBeInstanceOf(
        DelayedError,
      );

      expect(j.moveToDelayed).toHaveBeenCalledWith(expect.any(Number), "tok");
      expect(m.schedule.recordOutcome).not.toHaveBeenCalled();
    });

    it("rethrows a failure for backoff while attempts remain, recording nothing", async () => {
      const m = await make();
      m.timetable.syncOne.mockRejectedValue(new Error("db gone"));

      await expect(m.service.handle(job(data()))).rejects.toThrow("db gone");
      expect(m.schedule.recordOutcome).not.toHaveBeenCalled();
    });

    it("on the last attempt records the failure so the row is not left unmarked", async () => {
      const m = await make();
      m.timetable.syncOne.mockRejectedValue(new Error("db gone"));
      const j = job(data(), { attemptsMade: 4 });

      await expect(m.service.handle(j)).rejects.toThrow("db gone");
      expect(m.schedule.recordOutcome).toHaveBeenCalledWith("sch1", {
        ok: false,
        servedFromCache: false,
        now: expect.any(Date) as Date,
      });
    });

    it("a retried job records its outcome exactly once", async () => {
      const m = await make();
      m.timetable.syncOne
        .mockRejectedValueOnce(new Error("blip"))
        .mockResolvedValue(OK);

      await expect(m.service.handle(job(data()))).rejects.toThrow("blip");
      await m.service.handle(job(data(), { attemptsMade: 1 }));

      expect(m.schedule.recordOutcome).toHaveBeenCalledTimes(1);
    });

    it("does not count an exhausted park against the student", async () => {
      const m = await make({}, { LMS: null, PORTAL: 30_000 });
      const j = job(data(), { attemptsStarted: 200, attemptsMade: 0 });

      await expect(m.service.handle(j)).rejects.toBeInstanceOf(
        UpstreamUnavailableError,
      );
      expect(m.schedule.recordOutcome).not.toHaveBeenCalled();
    });
  });

  describe("manual jobs", () => {
    const manual = (kind: string) =>
      data({ kind, manual: true, scheduleId: "", claimedAt: undefined });

    it("defers the schedule, discovery included, after a clean timetable", async () => {
      const m = await make();

      await m.service.execute(manual("PORTAL_TIMETABLE"));

      expect(m.schedule.deferAfterManualSync).toHaveBeenCalledWith(
        "int1",
        ["PORTAL_DISCOVERY", "PORTAL_TIMETABLE"],
        expect.any(Date),
      );
      expect(m.schedule.recordOutcome).not.toHaveBeenCalled();
      // A manual target has no schedule row to claim.
      expect(m.timetable.syncOne).toHaveBeenCalledWith(
        { integrationId: "int1", userId: "u1" },
        expect.any(Date),
      );
    });

    it("counts a failed pass against only its own kind", async () => {
      const m = await make();
      m.exam.syncOne.mockResolvedValue({ ok: false, servedFromCache: false });

      await m.service.execute(manual("PORTAL_EXAM"));

      expect(m.schedule.markManualFailure).toHaveBeenCalledWith(
        "int1",
        "PORTAL",
        ["PORTAL_TIMETABLE"],
      );
      expect(m.schedule.deferAfterManualSync).not.toHaveBeenCalled();
    });
  });

  describe("onFinalFailure (stalled jobs)", () => {
    const stalled = new Error("job stalled more than allowable limit");

    it("hands a scheduled job's claim back, and is safe to repeat", async () => {
      const m = await make();
      const j = job(data());

      await m.service.onFinalFailure(j, stalled);
      await m.service.onFinalFailure(j, stalled);

      expect(m.schedule.releaseClaim).toHaveBeenCalledWith({
        scheduleId: "sch1",
        userId: "u1",
        integrationId: "int1",
        cacheHitStreak: 2,
        dueAt: new Date("2026-10-26T02:00:00.000Z"),
        claimedAt: new Date("2026-10-26T03:00:00.000Z"),
      });
      expect(m.schedule.recordOutcome).not.toHaveBeenCalled();
    });

    it("removes the failed job first so its id cannot swallow the retry", async () => {
      const m = await make();
      const j = job(data());

      await m.service.onFinalFailure(j, stalled);

      expect(j.remove).toHaveBeenCalledTimes(1);
      expect(j.remove.mock.invocationCallOrder[0]).toBeLessThan(
        m.schedule.releaseClaim.mock.invocationCallOrder[0],
      );
    });

    it("still hands the claim back when the job cannot be removed", async () => {
      const m = await make();
      const j = job(data(), {
        remove: jest.fn().mockRejectedValue(new Error("x")),
      });

      await m.service.onFinalFailure(j, stalled);

      expect(m.schedule.releaseClaim).toHaveBeenCalled();
    });

    it("ignores failures handle() already recorded, and manual jobs", async () => {
      const m = await make();

      await m.service.onFinalFailure(job(data()), new Error("boom"));
      await m.service.onFinalFailure(job(data({ manual: true })), stalled);

      expect(m.schedule.releaseClaim).not.toHaveBeenCalled();
      expect(m.schedule.recordOutcome).not.toHaveBeenCalled();
    });
  });
});
