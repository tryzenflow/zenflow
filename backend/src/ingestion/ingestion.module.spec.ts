import { ConfigModule } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { Test } from "@nestjs/testing";
import { IntegrationsModule } from "../integrations/integrations.module";
import { IntegrationsService } from "../integrations/integrations.service";
import { PrismaService } from "../prisma/prisma.service";
import { ExamWatcherService } from "./exam-watcher.service";
import { IngestionModule } from "./ingestion.module";
import { IngestionWorkerModule } from "./ingestion-worker.module";
import { IngestionScheduleService } from "./ingestion-schedule.service";
import { IngestionSyncService } from "./ingestion-sync.service";
import { IngestionTickerService } from "./ingestion-ticker.service";
import { LmsWatcherService } from "./lms-watcher.service";
import { TimetableWatcherService } from "./timetable-watcher.service";

/**
 * `IngestionModule` and `IntegrationsModule` are mutually dependent (the
 * watchers need `revealCredentials`; the manual sync trigger needs the
 * watchers), so both sides use `forwardRef`. Get one of them wrong and Nest
 * fails at **boot** with an "undefined dependency" — long after typecheck and
 * every unit spec have passed. This compiles the real graph, which is the only
 * thing that catches it.
 */
describe("IngestionModule ↔ IntegrationsModule", () => {
  beforeAll(() => {
    // The HTTP clients read these with getOrThrow at construction.
    process.env.LMS_URL ??= "https://lms.example.test";
    process.env.LMS_TIMEOUT_MS ??= "15000";
    process.env.PORTAL_API_URL ??= "https://portal.example.test";
    process.env.PORTAL_API_TIMEOUT_MS ??= "10000";
    process.env.PORTAL_API_KEY ??= "test-key";
    process.env.DKHP_API_URL ??= "https://dkhp.example.test";
    process.env.DKHP_API_KEY ??= "test-dkhp-key";
  });

  it("resolves the cycle in both directions", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        ScheduleModule.forRoot(),
        IngestionModule,
        IngestionWorkerModule,
        IntegrationsModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();

    // Watchers got their IntegrationsService...
    for (const watcher of [
      LmsWatcherService,
      TimetableWatcherService,
      ExamWatcherService,
    ]) {
      expect(moduleRef.get(watcher)).toBeDefined();
    }
    // ...and IntegrationsService got its way back to them.
    expect(moduleRef.get(IngestionSyncService)).toBeDefined();
    expect(moduleRef.get(IntegrationsService)).toBeDefined();

    // Issue #56's rolling scheduler, including the handle IntegrationsService
    // needs to seed a new integration's schedule rows on connect.
    expect(moduleRef.get(IngestionScheduleService)).toBeDefined();
    expect(moduleRef.get(IngestionTickerService)).toBeDefined();

    await moduleRef.close();
  });

  /**
   * Issue #56, acceptance criterion 1: "no watcher fires a full-population sweep
   * at a single instant anymore."
   *
   * The mechanical version of that claim. `@nestjs/schedule` discovers cron
   * handlers by the metadata its decorator writes onto the method, so the
   * absence of that metadata anywhere on the three watchers is exactly what
   * "these no longer have a cron" means. Asserted here rather than left to
   * review, because re-adding a `@Cron` to a watcher would silently restore the
   * burst while every other test still passed.
   */
  it("leaves the three watchers with no cron of their own", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        ScheduleModule.forRoot(),
        IngestionModule,
        IntegrationsModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();

    for (const watcher of [
      LmsWatcherService,
      TimetableWatcherService,
      ExamWatcherService,
    ]) {
      const proto = watcher.prototype as unknown as Record<string, unknown>;
      expect(proto.handleCron).toBeUndefined();
      const decorated = Object.getOwnPropertyNames(proto).filter((name) =>
        Reflect.getMetadataKeys(proto[name] as object)?.some((key) =>
          String(key).includes("SCHEDULE"),
        ),
      );
      expect(decorated).toEqual([]);
    }

    // The single heartbeat that replaced them.
    const ticker = IngestionTickerService.prototype as unknown as Record<
      string,
      unknown
    >;
    expect(
      Reflect.getMetadataKeys(ticker.handleTick as object).some((key) =>
        String(key).includes("SCHEDULE"),
      ),
    ).toBe(true);

    await moduleRef.close();
  });
});
