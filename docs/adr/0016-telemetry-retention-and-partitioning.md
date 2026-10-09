# ADR-0016: Keep telemetry 12 months, partitioned by range

**Status:** accepted
**Date:** 2026-10-09
**Issue:** #139

## Context
- `SessionEvent` is append-only and grows without bound: about 100k rows per day at 5k daily actives, about 36M rows and 20-25 GB per year with its four indexes ([ADR-0015](0015-launch-capacity-estimate.md)).
- Old events have little value after the bandit and experiment analysis window, and unbounded growth threatens a single small disk.
- Converting an empty table is far cheaper than a populated one, and launch is the last empty moment.

## Decision
- Retention: **12 months** of `SessionEvent`.
- Partition `SessionEvent` by **range on `occurredAt`**, one partition per month. The primary key becomes `(id, occurredAt)`.
- A worker job ([ADR-0011](0011-separate-api-worker-processes.md)) pre-creates the next two partitions and drops partitions older than 12 months; an alert fires if a future partition is missing (inserts would fail).
- The migration is hand-written SQL. Prisma has no native partitioning, but `prisma migrate diff` ignores partition children, so the CI drift check passes unchanged with the composite key declared as `@@id([id, occurredAt])`.
- Event replay: if a replay or streaming need appears, move the event log to **Kafka** later; not built now.
- Other tables (`SlotProposal`, `Notification`) are out of scope here; `SlotProposal` rows awaiting a reward must never be dropped.

## Consequences
- `id` alone is no longer unique to Prisma: update by id with `updateMany`, not `update`.
- Partitions are `SessionEvent_YYYY_MM`; the worker job is `SessionEventPartitionService` (daily 02:10 UTC), the alert `SessionEventPartitionMissing` fires when fewer than two future months exist.
- Dropping a month is an instant metadata operation with no bloat or vacuum cost.
- Queries should filter on `occurredAt` to prune partitions; the existing `(userId, occurredAt desc)` index is kept per partition.
- Extra operational surface: partition creation, the drift-check workaround, and restore tests that include the partitioned table ([ADR-0014](0014-postgres-backups-to-s3.md)).
- Anything older than 12 months is gone unless archived first; archive to S3 before drop if analysis needs it.
