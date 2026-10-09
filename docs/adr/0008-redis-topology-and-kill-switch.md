# ADR-0008: Redis is split by workload; the kill switch gets its own instance

**Status:** accepted
**Date:** 2026-10-09
**Issue:** #81

## Context
- One Redis cannot serve every workload: a cache wants eviction, flags and queues forbid it, rate limits want fast ephemeral state, pub/sub needs no storage at all.
- A kill switch must keep working when the rest of the stack is under memory pressure or being flushed. A flag silently evicted or lost would flip a safety control.
- etcd (the original request) adds a stateful cluster we do not need; we have no multi-service watch or leader-election requirement.

## Decision
One Redis instance per workload, all in the compose files. Kill-switch flags get a dedicated `redis-killswitch`.

| Instance | Holds | Eviction | Persistence |
| --- | --- | --- | --- |
| `redis` | sessions, OTP | `volatile-lru` (all keys carry a TTL) | AOF `everysec` + `--save 1800 1` |
| `redis-ratelimit` | rate-limit counters ([ADR-0005](0005-rate-limit-store-lru-rdb.md)) | `allkeys-lru` | RDB |
| `redis-killswitch` | feature flags | `noeviction` | AOF `everysec` |
| `redis-cache` (new) | cached reads ([ADR-0017](0017-redis-cache-instance.md)) | `allkeys-lru` | none |
| `redis-pubsub` | SSE fan-out ([ADR-0018](0018-redis-pubsub-instance.md)) | n/a | none |
| `redis-queue` | jobs ([ADR-0007](0007-bullmq-for-notification-queue.md)) | `noeviction` | AOF |

Kill switch: flags `ingestion`, `notifications`, `bandit` (off = heuristic placement), `signups`, `maintenance`, stored as `killswitch:<flag>` on `redis-killswitch` (`REDIS_KILLSWITCH_URL`).
- **Reads:** one Lua call refreshes every flag into a 5 s in-process snapshot; an unset URL, outage or timeout resolves to the per-flag fail-safe default (see the [runbook](../ops/kill-switch.md)).
- **Writes:** admin-only CLI. One Lua call does `SET` + `XADD killswitch:audit`, so a flag and its audit record cannot diverge. No HTTP endpoint, so no new admin auth surface.
- **Visibility:** `killswitch_flag_enabled{flag}` gauge and a Grafana dashboard.

etcd is not adopted; revisit only if multi-service watch or leader election becomes necessary.

Sessions `redis` moves from `noeviction` to `volatile-lru` so memory pressure can only drop TTL-bearing sessions, never a TTL-less key. Sessions are about 15 MB at 15k users against a 192 MB cap, so eviction should never trigger; alert at about 70% of `maxmemory` and on any `evicted_keys` increase.

## Consequences
- Flag reads survive a flush or outage of every other Redis.
- Three more small services (about 30-60 MB each idle) and three more URLs in `backend/.env.*`.
- A flag read must never block a request: cached and fail-safe by design.
