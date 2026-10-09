# ADR-0017: A dedicated Redis instance for caching

**Status:** accepted
**Date:** 2026-10-09
**Issue:** #134

## Context
- Caching wants eviction (`allkeys-lru`) and no persistence. Sessions and kill-switch flags forbid eviction, and rate-limit counters must not be pushed out by cache churn.
- Nothing is cached yet, but the first cache (for example the ingestion cache or hot calendar reads) will need a home that cannot harm the others.

## Decision
Add `redis-cache` to the dev, test, staging and prod compose files: `allkeys-lru`, no AOF or RDB, `mem_limit` about 128-256 MB, an exporter target, `REDIS_CACHE_URL` in `backend/.env.*` and a client provider next to the existing ioredis wiring. Keys carry TTLs and every cached value must be reproducible from the database. Topology: [ADR-0008](0008-redis-topology-and-kill-switch.md).

The sessions `redis` is tuned in the same change: AOF `everysec` plus `--save 1800 1`, `volatile-lru`, alerts at about 70% of `maxmemory` and on `evicted_keys`.

## Consequences
- Cache pressure cannot evict sessions, flags or rate-limit state; a cache outage must degrade to a database read, never an error.
- About 0.15-0.25 GB more memory on the host ([ADR-0015](0015-launch-capacity-estimate.md)).
- The instance idles until the first cache is built, which is tracked separately.
