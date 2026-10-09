import { Module } from "@nestjs/common";
import { QueueModule } from "../queue/queue.module";
import { LmsFetchProcessor, PortalFetchProcessor } from "./fetch.processor";
import { IngestionModule } from "./ingestion.module";

/** Consumer of the `portal-fetch` queue; imported only by roles that consume it. */
@Module({
  imports: [IngestionModule, QueueModule],
  providers: [PortalFetchProcessor],
})
export class PortalFetchWorkerModule {}

/** Consumer of the `lms-fetch` queue; imported only by roles that consume it. */
@Module({
  imports: [IngestionModule, QueueModule],
  providers: [LmsFetchProcessor],
})
export class LmsFetchWorkerModule {}
