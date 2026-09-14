import { Test, TestingModule } from "@nestjs/testing";
// `IngestionSyncService` must be imported before `ExamWatcherService` here:
// exam-watcher.service.ts -> integrations.service.ts -> ingestion-sync.service.ts
// is a real circular import (the IntegrationsModule <-> IngestionModule cycle
// documented on IngestionSyncService), and starting the module graph from
// ExamWatcherService instead makes `ExamWatcherService` still-undefined when
// IngestionSyncService's own `design:paramtypes` decorator metadata runs.
import { IngestionSyncService } from "./ingestion-sync.service";
import { ExamWatcherService } from "./exam-watcher.service";
import { LmsWatcherService } from "./lms-watcher.service";
import { TimetableWatcherService } from "./timetable-watcher.service";

const NOW = new Date("2026-09-06T04:00:00.000Z");

async function makeService() {
  const order: string[] = [];
  const lms = jest.fn(() => {
    order.push("lms");
    return Promise.resolve(1);
  });
  const timetable = jest.fn(() => {
    order.push("timetable");
    return Promise.resolve(1);
  });
  const exam = jest.fn(() => {
    order.push("exam");
    return Promise.resolve(1);
  });

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      IngestionSyncService,
      { provide: LmsWatcherService, useValue: { run: lms } },
      { provide: TimetableWatcherService, useValue: { run: timetable } },
      { provide: ExamWatcherService, useValue: { run: exam } },
    ],
  }).compile();
  const service = module.get<IngestionSyncService>(IngestionSyncService);

  return { service, lms, timetable, exam, order };
}

describe("IngestionSyncService", () => {
  it("runs only the LMS watcher for LMS, narrowed to the caller", async () => {
    const s = await makeService();

    await s.service.syncNow("u1", "LMS", NOW);

    expect(s.lms).toHaveBeenCalledWith(NOW, "u1");
    expect(s.timetable).not.toHaveBeenCalled();
    expect(s.exam).not.toHaveBeenCalled();
  });

  it("runs both portal watchers, one after the other", async () => {
    const s = await makeService();

    await s.service.syncNow("u1", "PORTAL", NOW);

    expect(s.lms).not.toHaveBeenCalled();
    expect(s.timetable).toHaveBeenCalledWith(NOW, "u1");
    expect(s.exam).toHaveBeenCalledWith(NOW, "u1");
    expect(s.order).toEqual(["timetable", "exam"]);
  });

  it("resolves only once the run is done, so the status can be re-read", async () => {
    const s = await makeService();
    let settled = false;
    s.exam.mockImplementation(
      () =>
        new Promise<number>((resolve) =>
          setTimeout(() => {
            settled = true;
            resolve(1);
          }, 5),
        ),
    );

    await s.service.syncNow("u1", "PORTAL", NOW);

    expect(settled).toBe(true);
  });
});
