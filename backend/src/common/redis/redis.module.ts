import { Global, Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { createClient, type RedisClientType } from "redis";
import { RATE_LIMIT_REDIS_CLIENT, REDIS_CLIENT } from "./redis.constants";

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
