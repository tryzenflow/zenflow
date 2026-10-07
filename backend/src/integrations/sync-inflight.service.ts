import { ConflictException, Inject, Injectable, Logger } from "@nestjs/common";
import type { Redis } from "ioredis";
import type { IntegrationProvider } from "@zenflow/shared";
import { RATE_LIMIT_REDIS_CLIENT } from "../common/redis/redis.constants";

/** In-flight lock TTL: a crashed run can't wedge the button for longer. */
export const SYNC_INFLIGHT_TTL_SEC = 120;

export function syncInflightKey(userId: string, provider: string): string {
  return `sync:inflight:${userId}:${provider}`;
}

/**
 * One manual sync at a time per user + provider (`SET NX EX`, released in
 * `finally`). LimitKit has no concurrency primitive, so this stays here; the
 * 3-per-6h quota itself is LimitKit's `@RateLimit` on the controller.
 *
 * Tradeoff: LimitKit's guard runs before the controller, so a duplicate that
 * this lock rejects with 409 has already spent a quota slot. The client should
 * disable the button while a sync is running.
 *
 * Uses the rate-limit Redis. Fails open if Redis is unreachable (as LimitKit does);
 * it cannot hang because that client has `commandTimeout` and no offline queue.
 */
@Injectable()
export class SyncInflightGuard {
  private readonly logger = new Logger(SyncInflightGuard.name);

  constructor(@Inject(RATE_LIMIT_REDIS_CLIENT) private readonly redis: Redis) {}

  /** Run `fn` under the lock; a concurrent duplicate throws 409. */
  async run<T>(
    userId: string,
    provider: IntegrationProvider,
    fn: () => Promise<T>,
  ): Promise<T> {
    const lockKey = syncInflightKey(userId, provider);
    let locked: boolean;
    try {
      locked =
        (await this.redis.set(
          lockKey,
          "1",
          "EX",
          SYNC_INFLIGHT_TTL_SEC,
          "NX",
        )) === "OK";
    } catch (err) {
      this.logger.warn(`In-flight lock unavailable, failing open: ${err}`);
      return fn();
    }
    if (!locked) {
      throw new ConflictException(
        "A sync for this account is already running. Wait for it to finish.",
      );
    }

    try {
      return await fn();
    } finally {
      await this.redis.del(lockKey).catch(() => undefined);
    }
  }
}
