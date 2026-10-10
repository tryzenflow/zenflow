import { Global, Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import {
  redisOptions,
  type RedisConnection,
} from "../common/config/connections";
import { OutboundBreakerModule } from "../common/outbound-breaker.module";
import { createQueueConnection } from "./queue-connection";
import { QUEUE_REDIS } from "./queue.constants";
import { QueueMetricsService } from "./queue-metrics.service";
import { QueueService } from "./queue.service";
import { QueueWorkers } from "./queue-workers.service";

/** Dev default: the `redis-queue` compose service on its host port. */
export const DEFAULT_QUEUE_REDIS: RedisConnection = {
  host: "localhost",
  port: 6381,
};

/**
 * BullMQ on the dedicated durable Redis (`QUEUE_REDIS_HOST`, ADR-0007/0008).
 * Global: any module injects `QueueService` (produce) or `QueueWorkers`
 * (consume). With `NODE_ENV=test` and no host the connection is `null` and the
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
        const connection = redisOptions(
          (key) => config.get(key),
          "QUEUE_REDIS",
        );
        if (!connection && config.get<string>("NODE_ENV") === "test") {
          return null;
        }
        return createQueueConnection(connection ?? DEFAULT_QUEUE_REDIS);
      },
    },
    QueueService,
    QueueWorkers,
    QueueMetricsService,
  ],
  exports: [QUEUE_REDIS, QueueService, QueueWorkers],
})
export class QueueModule {}
