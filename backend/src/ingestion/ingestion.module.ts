import { forwardRef, Module } from "@nestjs/common";
import { IntegrationsModule } from "../integrations/integrations.module";
import { LMSModule } from "../lms/lms.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { PortalAPIModule } from "../portal/portal-api.module";
import { PrismaModule } from "../prisma/prisma.module";
import { TagsModule } from "../tags/tags.module";
import { EnrollmentDiscoveryService } from "./enrollment-discovery.service";
import { ExamWatcherService } from "./exam-watcher.service";
import { IngestionJobsService } from "./ingestion-jobs.service";
import { IngestionScheduleService } from "./ingestion-schedule.service";
import { IngestionTickerService } from "./ingestion-ticker.service";
import { IngestionSyncService } from "./ingestion-sync.service";
import { LmsWatcherService } from "./lms-watcher.service";
import { MaterializerService } from "./materializer.service";
import { OccurrenceCacheService } from "./occurrence-cache.service";
import { OccurrenceFanoutService } from "./occurrence-fanout.service";
import { SyncConflictsService } from "./sync-conflicts.service";
import { TimetableWatcherService } from "./timetable-watcher.service";

/**
 * DLU ingestion — the three watcher crons and their write-back.
 *
 * Nothing here is exported for the sake of a controller of its own: the
 * watchers are background jobs, and the only client-facing handle on them is
 * `POST /integrations/:provider/sync` on `IntegrationsController`, which is why
 * {@link IngestionSyncService} is exported at all.
 * {@link IngestionScheduleService} is exported for the same narrow reason:
 * `IntegrationsService` has to seed a new integration's schedule rows the moment
 * a student connects, rather than leaving them to the next tick's backfill.
 *
 * `forwardRef` both ways is unavoidable and deliberate: ingestion needs
 * `IntegrationsService.revealCredentials` to decrypt a student's stored login,
 * and integrations needs the watchers to service the manual trigger. Splitting
 * an interface out to break the cycle would buy nothing — the two modules are
 * genuinely mutually dependent at this seam.
 *
 * `ScheduleModule.forRoot()` is already registered in `AppModule`, so the
 * `@Cron` decorator here needs no extra wiring. Since issue #56 there is
 * exactly one: {@link IngestionTickerService}'s heartbeat. The three watchers
 * have no cron of their own — the ticker claims them on a rolling schedule, so
 * no firing ever sweeps the whole student population at a single instant.
 */
@Module({
  imports: [
    PrismaModule,
    LMSModule,
    PortalAPIModule,
    TagsModule,
    NotificationsModule,
    forwardRef(() => IntegrationsModule),
  ],
  providers: [
    IngestionJobsService,
    SyncConflictsService,
    MaterializerService,
    LmsWatcherService,
    TimetableWatcherService,
    ExamWatcherService,
    IngestionSyncService,
    IngestionScheduleService,
    IngestionTickerService,
    EnrollmentDiscoveryService,
    OccurrenceCacheService,
    OccurrenceFanoutService,
  ],
  exports: [IngestionSyncService, IngestionScheduleService],
})
export class IngestionModule {}
