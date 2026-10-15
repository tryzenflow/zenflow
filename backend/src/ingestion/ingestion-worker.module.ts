import { Module } from "@nestjs/common";
import { LMSModule } from "../lms/lms.module";
import { PortalAPIModule } from "../portal/portal-api.module";
import { PrismaModule } from "../prisma/prisma.module";
import { QueueModule } from "../queue/queue.module";
import { IngestionModule } from "./ingestion.module";
import { IngestionTickerService } from "./ingestion-ticker.service";

/**
 * Watcher-only ingestion: the rolling-schedule heartbeat (`@Interval` every 5 seconds) that claims due targets and enqueues fetch jobs.
 * Kept out of {@link IngestionModule} so API processes register no cron
 * (ADR-0011). Needs `ScheduleModule`, which only the worker imports.
 */
@Module({
  imports: [
    IngestionModule,
    LMSModule,
    PortalAPIModule,
    PrismaModule,
    QueueModule,
  ],
  providers: [IngestionTickerService],
})
export class IngestionWorkerModule {}
