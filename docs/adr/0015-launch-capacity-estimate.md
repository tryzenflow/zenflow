# ADR-0015: Launch capacity estimate for 15k students on one 8 vCPU / 8 GB host

**Status:** proposed (estimates, to be validated)
**Date:** 2026-10-09
**Issue:** #138

## Context
Launch is 15k registered students, about 5k daily actives, on one Linux host with 8 vCPU and 8 GB RAM. The only measurements are from the [staging load test](../benchmarks/2026-10-staging-loadtest.md): an M1 Max VM (16 vCPU / 32 GiB) with 1,500 seeded users, where 1x is 250 concurrent users at one action per 10 s.

## Decision
Plan the host with these figures and re-measure on the real box ([ADR-0009](0009-load-test-follow-ups.md)).

**Load.** Peak concurrency is about 5-10% of daily actives, so 250-500 concurrent users (1x-2x). Measured at 2x: API 0.9 cores / 450 MiB, Postgres 0.4 cores, bandit 0.14 cores. Allow 1.5-2x for slower cloud cores: roughly 4-5 cores busy at peak. One Node loop tops out at about 3-4x, so run 2-3 API processes ([ADR-0011](0011-separate-api-worker-processes.md)).

**Memory (about 6.5 GB of 8):**

| Component | RAM |
| --- | --- |
| 3 x API (`--max-old-space-size=768`) | 1.5 GB |
| Postgres (`shared_buffers` 1 GB) | 1.5 GB |
| Bandit (2 workers) | 0.6 GB |
| Redis instances ([ADR-0008](0008-redis-topology-and-kill-switch.md)) | 0.4 GB |
| MinIO, Vault, nginx | 0.4 GB |
| Observability | 2-2.3 GB |

Trim observability (drop `grafana-renderer`, cap Prometheus), add 2 GB swap. A blue-green overlap adds up to 1.5-2 GB.

**Storage.** `Session` is about 87 rows per user: 1.3M rows, about 0.7 GB with indexes at 15k users. Telemetry about 100k events per day: 20-25 GB per year ([ADR-0016](0016-telemetry-retention-and-partitioning.md)). Redis sessions about 15 MB. Postgres year one about 15-30 GB; provision 100+ GB, plus MinIO (attachment policy unknown) and Prometheus.

**Connections.** Prisma defaults to 17 per process, so 3 processes use about 51 of 100 ([ADR-0019](0019-pgbouncer-deferred.md)).

## Consequences
- The host fits launch only with the series-index fix, 2-3 API processes and trimmed observability.
- It is a single point of failure; backups are mandatory ([ADR-0014](0014-postgres-backups-to-s3.md)).
- Update this ADR with measured numbers after the 5k-user run.
