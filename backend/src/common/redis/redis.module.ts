import { Global, Logger, Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { createClient, type RedisClientType } from "redis";
import { RATE_LIMIT_REDIS_CLIENT, REDIS_CLIENT } from "./redis.constants";

const logger = new Logger("RedisModule");

/**
 * Builds a `redis` (node-redis) client for the given connection URL. In
 * tests (`NODE_ENV === "test"`) the client is constructed but never
 * connected — nothing in a test run should be exercising a real store (the
 * rate limiter falls back to `@limitkit/memory`, and tests don't run
 * `main.ts`'s `bootstrap()`, so no session middleware ever touches
 * `REDIS_CLIENT` either), so skipping the network round trip keeps
 * unit/e2e tests Docker-free.
 */
async function createRedisClient(
  configService: ConfigService,
  urlKey: string,
): Promise<RedisClientType> {
  const client = createClient({
    url: configService.get<string>(urlKey),
  });
  // node-redis emits `error` on every failed connection attempt, including
  // ones its own `reconnectStrategy` is about to retry with backoff — e.g.
  // the Docker Desktop port-forward on Windows can lag a moment behind
  // `docker compose up` reporting the container started. An `EventEmitter`
  // with no `error` listener throws on emit, which crashed the whole process
  // on that first transient timeout instead of letting the retry proceed.
  client.on("error", (err) => logger.warn(`Redis client error: ${err}`));
  if (configService.get<string>("NODE_ENV") !== "test") {
    await client.connect();
  }
  return client as RedisClientType;
}

/**
 * Provides two independent `redis` (node-redis) clients, kept on separate
 * physical Redis instances so rate-limit counter churn can't evict or
 * contend with session/OTP data:
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
