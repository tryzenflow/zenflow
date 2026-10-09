import { Global, Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { OutboundBreakerModule } from "../common/outbound-breaker.module";
import { createQueueConnection } from "./queue-connection";
import { QUEUE_REDIS } from "./queue.constants";
import { QueueMetricsService } from "./queue-metrics.service";
import { QueueService } from "./queue.service";
import { QueueWorkers } from "./queue-workers.service";

/** Dev default: the `redis-queue` compose service on its host port. */
export const DEFAULT_QUEUE_REDIS_URL = "redis://localhost:6381";

/**
 * BullMQ on the dedicated durable Redis (`QUEUE_REDIS_URL`, ADR-0007/0008).
 * Global: any module injects `QueueService` (produce) or `QueueWorkers`
 * (consume). With `NODE_ENV=test` and no URL the connection is `null` and the
 * service records jobs in memory instead (see `QueueService.memory`).
 */
@Global()
@Module({
  imports: [ConfigModule, OutboundBreakerModule],
  providers: [
    {
      provide: QUEUE_REDIS,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const url = config.get<string>("QUEUE_REDIS_URL");
        if (!url && config.get<string>("NODE_ENV") === "test") return null;
        return createQueueConnection(url ?? DEFAULT_QUEUE_REDIS_URL);
      },
    },
    QueueService,
    QueueWorkers,
    QueueMetricsService,
  ],
  exports: [QUEUE_REDIS, QueueService, QueueWorkers],
})
export class QueueModule {}
