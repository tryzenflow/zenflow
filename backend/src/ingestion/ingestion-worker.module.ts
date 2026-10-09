import { Module } from "@nestjs/common";
import { LMSModule } from "../lms/lms.module";
import { PortalAPIModule } from "../portal/portal-api.module";
import { IngestionModule } from "./ingestion.module";
import { IngestionTickerService } from "./ingestion-ticker.service";

/**
 * Worker-only ingestion: the rolling-schedule heartbeat (`@Cron` every minute).
 * Kept out of {@link IngestionModule} so API processes register no cron
 * (ADR-0011). Needs `ScheduleModule`, which only the worker imports.
 */
@Module({
  imports: [IngestionModule, LMSModule, PortalAPIModule],
  providers: [IngestionTickerService],
})
export class IngestionWorkerModule {}
