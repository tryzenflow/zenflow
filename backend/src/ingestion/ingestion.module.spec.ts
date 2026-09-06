import { ConfigModule } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { Test } from "@nestjs/testing";
import { IntegrationsModule } from "../integrations/integrations.module";
import { IntegrationsService } from "../integrations/integrations.service";
import { PrismaService } from "../prisma/prisma.service";
import { ExamWatcherService } from "./exam-watcher.service";
import { IngestionModule } from "./ingestion.module";
import { IngestionSyncService } from "./ingestion-sync.service";
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
  });

  it("resolves the cycle in both directions", async () => {
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

    await moduleRef.close();
  });
});
