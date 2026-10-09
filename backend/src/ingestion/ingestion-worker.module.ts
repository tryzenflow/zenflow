import { Module } from "@nestjs/common";
import { LMSModule } from "../lms/lms.module";
import { PortalAPIModule } from "../portal/portal-api.module";
import { QueueModule } from "../queue/queue.module";
import { IngestionModule } from "./ingestion.module";
import { IngestionTickerService } from "./ingestion-ticker.service";

/**
 * Watcher-only ingestion: the rolling-schedule heartbeat (`@Cron` every minute) that claims due targets and enqueues fetch jobs.
 * Kept out of {@link IngestionModule} so API processes register no cron
 * (ADR-0011). Needs `ScheduleModule`, which only the worker imports.
 */
@Module({
  imports: [IngestionModule, LMSModule, PortalAPIModule, QueueModule],
  providers: [IngestionTickerService],
})
export class IngestionWorkerModule {}
