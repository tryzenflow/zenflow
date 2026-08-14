import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { LimitModule } from "@limitkit/nest";
import { RedisStore, fixedWindow as redisFixedWindow } from "@limitkit/redis";
import {
  InMemoryStore,
  fixedWindow as memoryFixedWindow,
} from "@limitkit/memory";
import type { RedisClientType } from "redis";
import { RedisModule } from "../redis/redis.module";
import { RATE_LIMIT_REDIS_CLIENT } from "../redis/redis.constants";
import { setRateLimitRuntimeConfig } from "./rate-limit.constants";
import { TooManyRequestsFilter } from "./too-many-requests.filter";

// `RateLimiter`'s constructor throws `EmptyRulesException` if given zero
// rules, so the module-level (global) config can't just be `rules: []`.
// This single, extremely generous fixed window keeps `LimitGuard` (wired as
// `APP_GUARD`, so it runs on every request) from ever actually throttling a
// route that hasn't opted in — only `@RateLimit()` on the OTP handlers (see
// `rate-limit.rules.ts`) adds a rule that can realistically trip.
const GLOBAL_NOOP_LIMIT = 1_000_000;

/**
 * Registers LimitKit's NestJS integration with a global rule set that's a
 * no-op in practice (see `GLOBAL_NOOP_LIMIT` above). Routes opt into real
 * limiting by attaching their own rules via `@RateLimit()`, which is how
 * this stays scoped to the OTP endpoints instead of throttling the whole
 * API.
 *
 * Store: `@limitkit/redis`'s `RedisStore`, backed by its own dedicated
 * `RATE_LIMIT_REDIS_CLIENT` (see `common/redis/`) — a separate Redis
 * instance from the session/OTP one, so rate-limit counter churn can't
 * evict or contend with that data — outside tests; `@limitkit/memory`'s
 * `InMemoryStore` when `NODE_ENV === "test"`, so tests never depend on a
 * running Redis for rate-limit state (they may still need Redis for
 * whatever else they exercise — this only concerns the limiter).
 */
@Module({
  imports: [
    RedisModule,
    LimitModule.forRootAsync({
      imports: [ConfigModule, RedisModule],
      inject: [ConfigService, RATE_LIMIT_REDIS_CLIENT],
      useFactory: (
        configService: ConfigService,
        rateLimitRedisClient: RedisClientType,
      ) => {
        const isTest = configService.get<string>("NODE_ENV") === "test";

        setRateLimitRuntimeConfig({
          storeKind: isTest ? "memory" : "redis",
          otpRequestIp: {
            window: configService.get<number>("OTP_REQUEST_IP_WINDOW_SEC")!,
            limit: configService.get<number>("OTP_REQUEST_IP_LIMIT")!,
          },
          otpRequestEmail: {
            window: configService.get<number>("OTP_REQUEST_EMAIL_WINDOW_SEC")!,
            limit: configService.get<number>("OTP_REQUEST_EMAIL_LIMIT")!,
          },
          otpVerifyIp: {
            window: configService.get<number>("OTP_VERIFY_IP_WINDOW_SEC")!,
            limit: configService.get<number>("OTP_VERIFY_IP_LIMIT")!,
          },
          otpVerifyEmail: {
            window: configService.get<number>("OTP_VERIFY_EMAIL_WINDOW_SEC")!,
            limit: configService.get<number>("OTP_VERIFY_EMAIL_LIMIT")!,
          },
        });

        return {
          store: isTest
            ? new InMemoryStore()
            : new RedisStore(rateLimitRedisClient),
          rules: [
            {
              name: "global-noop",
              key: "global",
              policy: isTest
                ? memoryFixedWindow({ window: 1, limit: GLOBAL_NOOP_LIMIT })
                : redisFixedWindow({ window: 1, limit: GLOBAL_NOOP_LIMIT }),
            },
          ],
          debug: false,
        };
      },
    }),
  ],
  providers: [{ provide: APP_FILTER, useClass: TooManyRequestsFilter }],
  exports: [LimitModule],
})
export class RateLimitModule {}
