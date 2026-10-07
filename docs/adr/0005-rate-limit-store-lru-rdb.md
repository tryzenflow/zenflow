# ADR-0005: Rate-limit store is Redis with LRU eviction and RDB snapshots

**Status:** accepted
**Date:** 2026-10-07

## Context
- Rate-limit state is ephemeral: counters describe short windows, and outdated windows are discarded anyway.
- Losing counters is cheap: a client briefly gets a fresh allowance.
- The API is expected to run more than one process ([staging load test](../benchmarks/2026-10-staging-loadtest.md)), so limits must be shared across processes.

## Decision
Keep the dedicated `redis-ratelimit` service (LimitKit's store) and configure it in `backend/compose.prod.yml` (mirrored in `compose.staging.yml`); no app code changes.

| Setting | Value |
| --- | --- |
| `--maxmemory` / `mem_limit` | `64mb` / `128m` |
| `--maxmemory-policy` | `allkeys-lru` |
| `--save` | `"15 1"` (RDB snapshot every 15 s when at least 1 key changed) |
| `--appendonly` | `no` |
| Volume | `redis_ratelimit_data` at `/data` |
| Other | `restart: unless-stopped`, `redis-cli ping` healthcheck; the API waits for `service_healthy` |

Rejected: an in-process LRU. It is per instance, so with N API processes every limit would silently become N times looser.

## Consequences
- A crash loses at most about 15 s of counters.
- Under memory pressure the least recently used keys are evicted, so those clients fail open (get a fresh window).
- The store fails open behind a circuit breaker (`ResilientStore`, `RATE_LIMIT_STORE_TIMEOUT_MS`, default 250): if this Redis is down or slow, requests are allowed instead of stalling, and the breaker skips the store until a probe succeeds. This adds app code beyond the compose settings above.
- Keep it separate from the sessions/OTP `redis`, which runs `noeviction` with AOF (eviction there would log users out), and from any future BullMQ Redis, which also needs `noeviction` plus persistence.
- No data migration. The new volumes start empty.
