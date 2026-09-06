import type { ExamWatcherService } from "./exam-watcher.service";
import { IngestionSyncService } from "./ingestion-sync.service";
import type { LmsWatcherService } from "./lms-watcher.service";
import type { TimetableWatcherService } from "./timetable-watcher.service";

const NOW = new Date("2026-09-06T04:00:00.000Z");

function makeService() {
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

  const service = new IngestionSyncService(
    { run: lms } as unknown as LmsWatcherService,
    { run: timetable } as unknown as TimetableWatcherService,
    { run: exam } as unknown as ExamWatcherService,
  );

  return { service, lms, timetable, exam, order };
}

describe("IngestionSyncService", () => {
  it("runs only the LMS watcher for LMS, narrowed to the caller", async () => {
    const s = makeService();

    await s.service.syncNow("u1", "LMS", NOW);

    expect(s.lms).toHaveBeenCalledWith(NOW, "u1");
    expect(s.timetable).not.toHaveBeenCalled();
    expect(s.exam).not.toHaveBeenCalled();
  });

  it("runs both portal watchers, one after the other", async () => {
    const s = makeService();

    await s.service.syncNow("u1", "PORTAL", NOW);

    expect(s.lms).not.toHaveBeenCalled();
    expect(s.timetable).toHaveBeenCalledWith(NOW, "u1");
    expect(s.exam).toHaveBeenCalledWith(NOW, "u1");
    expect(s.order).toEqual(["timetable", "exam"]);
  });

  it("resolves only once the run is done, so the status can be re-read", async () => {
    const s = makeService();
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
