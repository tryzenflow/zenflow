import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
// `IngestionSyncService` must be imported before `ExamWatcherService` here:
// exam-watcher.service.ts -> integrations.service.ts -> ingestion-sync.service.ts
// is a real circular import (the IntegrationsModule <-> IngestionModule cycle
// documented on IngestionSyncService), and starting the module graph from
// ExamWatcherService instead makes `ExamWatcherService` still-undefined when
// IngestionSyncService's own `design:paramtypes` decorator metadata runs.
import { IngestionSyncService } from "./ingestion-sync.service";
import { LMSService } from "../lms/lms.service";
import { PortalAPIService } from "../portal/portal-api.service";
import { ExamWatcherService } from "./exam-watcher.service";
import { LmsWatcherService } from "./lms-watcher.service";
import { TimetableWatcherService } from "./timetable-watcher.service";

const NOW = new Date("2026-09-06T04:00:00.000Z");

async function makeService(
  waits: { LMS: number | null; PORTAL: number | null } = {
    LMS: null,
    PORTAL: null,
  },
  enabled = true,
) {
  const order: string[] = [];
  const pass = (name: string, ok = true) =>
    jest.fn(() => {
      order.push(name);
      return Promise.resolve({ ok, servedFromCache: false });
    });
  const lms = pass("lms");
  const timetable = pass("timetable");
  const exam = pass("exam");
  // `eachIntegrationTarget` pages through `integration.findMany`.
  const findMany = jest.fn().mockResolvedValue([{ id: "int1", userId: "u1" }]);

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      IngestionSyncService,
      { provide: PrismaService, useValue: { integration: { findMany } } },
      {
        provide: ConfigService,
        useValue: {
          get: (n: string) => (n === "INGESTION_ENABLED" ? enabled : undefined),
        },
      },
      { provide: LmsWatcherService, useValue: { syncOne: lms } },
      { provide: TimetableWatcherService, useValue: { syncOne: timetable } },
      { provide: ExamWatcherService, useValue: { syncOne: exam } },
      { provide: LMSService, useValue: { unavailableFor: () => waits.LMS } },
      {
        provide: PortalAPIService,
        useValue: { unavailableFor: () => waits.PORTAL },
      },
    ],
  }).compile();
  const service = module.get<IngestionSyncService>(IngestionSyncService);

  return { service, lms, timetable, exam, order, findMany };
}

const TARGET = { integrationId: "int1", userId: "u1" };

describe("IngestionSyncService", () => {
  it("runs only the LMS pass for LMS, narrowed to the caller", async () => {
    const s = await makeService();

    const outcome = await s.service.syncNow("u1", "LMS", NOW);

    expect(s.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { provider: "LMS", userId: "u1" } }),
    );
    expect(s.lms).toHaveBeenCalledWith(TARGET, NOW);
    expect(s.timetable).not.toHaveBeenCalled();
    expect(s.exam).not.toHaveBeenCalled();
    expect(outcome).toEqual({ synced: ["LMS_CALENDAR"], complete: true });
  });

  it("runs both portal passes, one after the other", async () => {
    const s = await makeService();

    const outcome = await s.service.syncNow("u1", "PORTAL", NOW);

    expect(s.lms).not.toHaveBeenCalled();
    expect(s.timetable).toHaveBeenCalledWith(TARGET, NOW);
    expect(s.exam).toHaveBeenCalledWith(TARGET, NOW);
    expect(s.order).toEqual(["timetable", "exam"]);
    expect(outcome).toEqual({
      synced: ["PORTAL_DISCOVERY", "PORTAL_TIMETABLE", "PORTAL_EXAM"],
      complete: true,
    });
  });

  it("leaves a failed pass out and marks the run incomplete", async () => {
    const s = await makeService();
    s.timetable.mockResolvedValue({ ok: false, servedFromCache: false });

    // Exam still ran and succeeded; the timetable (and so discovery) did not —
    // e.g. no DKHP token. That must not read as a clean run.
    expect(await s.service.syncNow("u1", "PORTAL", NOW)).toEqual({
      synced: ["PORTAL_EXAM"],
      complete: false,
    });

    s.exam.mockResolvedValue({ ok: false, servedFromCache: false });
    expect(await s.service.syncNow("u1", "PORTAL", NOW)).toEqual({
      synced: [],
      complete: false,
    });
  });

  it("does nothing when ingestion is switched off", async () => {
    const s = await makeService(undefined, false);

    expect(await s.service.syncNow("u1", "LMS", NOW)).toEqual({
      synced: [],
      complete: false,
    });
    expect(s.lms).not.toHaveBeenCalled();
  });

  it("reports each provider's breaker wait, null when closed", async () => {
    const s = await makeService({ LMS: 42_000, PORTAL: null });

    expect(s.service.upstreamUnavailableFor("LMS")).toBe(42_000);
    expect(s.service.upstreamUnavailableFor("PORTAL")).toBeNull();
  });

  it("resolves only once the run is done, so the status can be re-read", async () => {
    const s = await makeService();
    let settled = false;
    s.exam.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(() => {
            settled = true;
            resolve({ ok: true, servedFromCache: false });
          }, 5),
        ),
    );

    await s.service.syncNow("u1", "PORTAL", NOW);

    expect(settled).toBe(true);
  });
});
