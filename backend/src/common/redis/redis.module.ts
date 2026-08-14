import { Global, Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { createClient } from "redis";
import { REDIS_CLIENT } from "./redis.constants";

/**
 * Provides the single, shared `redis` (node-redis) client connected to
 * `CACHE_URL`. Every consumer that needs a raw Redis connection (the
 * session store in `main.ts`, the LimitKit rate limiter in
 * `common/rate-limit/`) injects `REDIS_CLIENT` instead of opening its own
 * connection.
 *
 * In tests (`NODE_ENV === "test"`) the client is constructed but never
 * connected — nothing in a test run should be exercising the real store
 * (the rate limiter falls back to `@limitkit/memory`, and tests don't run
 * `main.ts`'s `bootstrap()`, so no session middleware ever touches it
 * either), so skipping the network round trip keeps unit/e2e tests
 * Docker-free.
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => {
        const client = createClient({
          url: configService.get<string>("CACHE_URL"),
        });
        if (configService.get<string>("NODE_ENV") !== "test") {
          await client.connect();
        }
        return client;
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
