import { Global, Logger, Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import Redis from "ioredis";
import { RATE_LIMIT_REDIS_CLIENT, REDIS_CLIENT } from "./redis.constants";

const logger = new Logger("RedisModule");

/**
 * Builds an `ioredis` client for the given connection URL.
 *
 * Deliberately synchronous — it never awaits a connection. `ioredis` queues
 * commands until it connects instead of requiring an explicit `.connect()`
 * up front (unlike node-redis), which is exactly the property we need: a
 * Redis instance that's slow to accept connections (a lagging Docker
 * port-forward, a mid-restart container) delays the first real command
 * instead of hanging `NestFactory.create()` — and every failed attempt
 * retries via `retryStrategy` instead of ever rejecting/throwing.
 *
 * In tests (`NODE_ENV === "test"`) the client is built with `lazyConnect`
 * so it never even attempts a connection until a command is issued — nothing
 * in a test run should be exercising a real store (the rate limiter falls
 * back to `@limitkit/memory`, and tests don't run `main.ts`'s `bootstrap()`,
 * so no session middleware ever touches `REDIS_CLIENT` either), keeping
 * unit/e2e tests Docker-free.
 */
function createRedisClient(
  configService: ConfigService,
  urlKey: string,
): Redis {
  const isTest = configService.get<string>("NODE_ENV") === "test";
  const client = new Redis(configService.get<string>(urlKey)!, {
    lazyConnect: isTest,
  });
  // An `EventEmitter` with no `error` listener throws on emit, which would
  // crash the whole process on the first connection failure instead of
  // letting `retryStrategy`'s backoff proceed.
  client.on("error", (err) => logger.warn(`Redis client error: ${err}`));
  return client;
}

/**
 * Provides two independent `ioredis` clients, kept on separate physical
 * Redis instances so rate-limit counter churn can't evict or contend with
 * session/OTP data:
 *
 * - `REDIS_CLIENT`, connected to `CACHE_URL` — backs the session store in
 *   `main.ts` (OTP codes live on the same physical Redis too, via
 *   `@nestjs/cache-manager`/keyv in `app.module.ts`, just through a
 *   different client library).
 * - `RATE_LIMIT_REDIS_CLIENT`, connected to `RATE_LIMIT_CACHE_URL` — backs
 *   the LimitKit rate limiter in `common/rate-limit/`.
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        createRedisClient(configService, "CACHE_URL"),
    },
    {
      provide: RATE_LIMIT_REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        createRedisClient(configService, "RATE_LIMIT_CACHE_URL"),
    },
  ],
  exports: [REDIS_CLIENT, RATE_LIMIT_REDIS_CLIENT],
})
export class RedisModule {}
