import { forwardRef, Module } from "@nestjs/common";
import { IntegrationsModule } from "../integrations/integrations.module";
import { LMSModule } from "../lms/lms.module";
import { PortalAPIModule } from "../portal/portal-api.module";
import { PrismaModule } from "../prisma/prisma.module";
import { TagsModule } from "../tags/tags.module";
import { ExamWatcherService } from "./exam-watcher.service";
import { IngestionJobsService } from "./ingestion-jobs.service";
import { IngestionSyncService } from "./ingestion-sync.service";
import { LmsWatcherService } from "./lms-watcher.service";
import { MaterializerService } from "./materializer.service";
import { TimetableWatcherService } from "./timetable-watcher.service";

/**
 * DLU ingestion — the three watcher crons and their write-back.
 *
 * Nothing here is exported for the sake of a controller of its own: the
 * watchers are background jobs, and the only client-facing handle on them is
 * `POST /integrations/:provider/sync` on `IntegrationsController`, which is why
 * {@link IngestionSyncService} is exported at all.
 *
 * `forwardRef` both ways is unavoidable and deliberate: ingestion needs
 * `IntegrationsService.revealCredentials` to decrypt a student's stored login,
 * and integrations needs the watchers to service the manual trigger. Splitting
 * an interface out to break the cycle would buy nothing — the two modules are
 * genuinely mutually dependent at this seam.
 *
 * `ScheduleModule.forRoot()` is already registered in `AppModule`, so the
 * `@Cron` decorators here need no extra wiring.
 */
@Module({
  imports: [
    PrismaModule,
    LMSModule,
    PortalAPIModule,
    TagsModule,
    forwardRef(() => IntegrationsModule),
  ],
  providers: [
    IngestionJobsService,
    MaterializerService,
    LmsWatcherService,
    TimetableWatcherService,
    ExamWatcherService,
    IngestionSyncService,
  ],
  exports: [IngestionSyncService],
})
export class IngestionModule {}
