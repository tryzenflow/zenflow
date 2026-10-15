import { Module } from "@nestjs/common";
import { QueueModule } from "../queue/queue.module";
import { LmsFetchProcessor, PortalFetchProcessor } from "./fetch.processor";
import { LmsSplitProcessor, PortalSplitProcessor } from "./split.processors";
import { IngestionModule } from "./ingestion.module";

/** Consumer of the `portal-fetch` queue; imported only by roles that consume it. */
@Module({
  imports: [IngestionModule, QueueModule],
  providers: [PortalFetchProcessor, PortalSplitProcessor],
})
export class PortalFetchWorkerModule {}

/** Consumer of the `lms-fetch` queue; imported only by roles that consume it. */
@Module({
  imports: [IngestionModule, QueueModule],
  providers: [LmsFetchProcessor, LmsSplitProcessor],
})
export class LmsFetchWorkerModule {}
