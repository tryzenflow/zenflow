/**
 * DI token for the `redis` (node-redis) client connected to `CACHE_URL`,
 * backing sessions (`main.ts`) and OTP codes (via `@nestjs/cache-manager` on
 * the same physical Redis, see `app.module.ts`'s `CacheModule`).
 */
export const REDIS_CLIENT = Symbol("REDIS_CLIENT");

/**
 * DI token for the separate `redis` (node-redis) client connected to
 * `RATE_LIMIT_CACHE_URL`, dedicated to LimitKit's rate-limit counters (see
 * `common/rate-limit/`). Kept on its own Redis instance so high-churn,
 * short-TTL counter keys can't evict or contend with session/OTP data.
 */
export const RATE_LIMIT_REDIS_CLIENT = Symbol("RATE_LIMIT_REDIS_CLIENT");
