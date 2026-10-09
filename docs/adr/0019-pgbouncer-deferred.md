# ADR-0019: pgbouncer is deferred

**Status:** accepted (deferred)
**Date:** 2026-10-09
**Issue:** #140

## Context
- Prisma's pool defaults to `num_cpus * 2 + 1`, 17 connections per process on 8 CPUs. Three API processes use about 51 connections against Postgres' default `max_connections = 100`; the load test used 10-11 at 3x.
- The API already handles the expected traffic without exhausting the pool ([ADR-0015](0015-launch-capacity-estimate.md)).
- pgbouncer adds a component and traps: Prisma needs `?pgbouncer=true` (or pgbouncer 1.21+ prepared-statement support), `prisma migrate deploy` takes an advisory lock and needs a direct URL, and Postgres 18 uses SCRAM authentication.

## Decision
Do not add pgbouncer for launch. Revisit when Prisma pool wait shows in metrics ([ADR-0009](0009-load-test-follow-ups.md)) or connections exceed about 70% of `max_connections`.

When added, use transaction mode: `DATABASE_URL` through pgbouncer with `?pgbouncer=true&connection_limit=N`, a `directUrl` (`DIRECT_URL`) in `schema.prisma` for migrations and the backup job ([ADR-0014](0014-postgres-backups-to-s3.md)), `auth_type = scram-sha-256`. The app's interactive transactions and `SELECT ... FOR UPDATE` are safe in transaction mode; it uses no advisory locks, `LISTEN`/`NOTIFY` or `SET LOCAL`.

## Consequences
- One fewer moving part at launch.
- Cap `connection_limit` per API process so replicas stay below Postgres' limit until pgbouncer exists.
