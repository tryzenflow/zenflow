# ADR-0009: Act on the #77 load-test findings before launch

**Status:** accepted
**Date:** 2026-10-09
**Issue:** #130

## Context
The [staging load test](../benchmarks/2026-10-staging-loadtest.md) (#77) passed every draft SLO to 3x load, and found:
- `SELECT ... FROM "Session" WHERE "seriesId" IN (...) ORDER BY "createdAt"` is about 75% of DB time: a parallel seq scan, because the only `seriesId` index also leads with `userId`.
- One Node event loop is the ceiling (ELU 0.75 at 3x, about 3-4x capacity).
- It was one run on a larger host: no 5k-user, breaking-point or soak result, no `pg_stat_statements` in prod, no pool metrics.

## Decision
- Query: add `userId` to the lookup in `session-crud.service.ts`; add `@@index([seriesId, createdAt])` on `Session` (also serves the `SessionSeries` delete's foreign-key check).
- Run several API processes ([ADR-0011](0011-separate-api-worker-processes.md)).
- Enable `pg_stat_statements` and postgres-exporter in prod; tune Postgres for 8 GB; expose Prisma pool metrics.
- Re-run the load test on the production host with 5,000 users, then the breaking-point and soak runs, and publish a new dated report ([ADR-0015](0015-launch-capacity-estimate.md)).

## Consequences
- The hottest query drops out of the profile; the index adds a small write cost on `Session`.
- Capacity numbers become measurements instead of extrapolations.
- The report ran on Postgres 16.15 while the committed stacks use 18.4; the re-run corrects that.
