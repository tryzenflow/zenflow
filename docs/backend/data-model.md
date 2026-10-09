# Backend data model

For: developers changing the schema or reading Session data. Source of truth: [`schema.prisma`](../../backend/prisma/schema.prisma) (client generated to `generated/prisma`).

| Table | Purpose | Notes |
| --- | --- | --- |
| `User` | Account and scheduling profile | `preferenceMatrix`: 168 signed floats (7x24), decayed nightly, lazily seeded. The scheduler places across the full 24 h grid (no `workStart`/`workEnd`/`workDays`). |
| `Session` | Every calendar item | See below. |
| `SessionSeries` | Recurring or `TASK` series | A recurring fixed session is one series plus one representative row, fanned to occurrences at read time. |
| `SessionReminder` | Up to 2 per session | Fired by in-memory `SchedulerRegistry` timers; see [scheduler.md](scheduler.md#session-reminders). |
| `SessionEvent` | Append-only audit trail (ML input) | `eventType`: `CREATE`, `MOVE`, `RESIZE`, `RETAINED`, `SYSTEM_MOVE` (scheduler-initiated, reward 0). `rewardScore` feeds LinUCB. Monthly range partitions on `occurredAt`, 12 months kept ([ADR-0016](../adr/0016-telemetry-retention-and-partitioning.md)); PK is `(id, occurredAt)`. |
| `Tag` | Per-user label | Wire format is `Session.tags: string[]`; unknown names are upserted per user. |
| `File`, `UserDevice` | Uploads, push registrations | `UserDevice.pushToken` is unique (upsert key). |
| `Integration`, `UserEncryptionKey` | Encrypted DLU credentials | Master keys are env-only, never in the DB. |
| DLU tables: `LmsCourse`, `PortalSection`, `*SyncJob(Item)`, `Notification`, `IngestionSchedule`, `*Enrollment`, `*Occurrence` | Ingestion catalog, job tracking, cross-student cache | See [ingestion.md](ingestion.md). |

## Session

- `type`: `TASK` (engine-placed), `ASSIGNMENT`, `EXAM`, `LECTURE`, `DND` (user-pinned).
- `source`: `USER`, `LMS`, `PORTAL`.
- `deleted` is a soft-delete flag. Every scheduling and calendar read filters it, except the materializer's idempotency lookup.
- `scheduledStartTime` is never null on a live `TASK` ([never unplaced](scheduler.md#python-authoritative-placement)).
- `syncConfirmedAt` / `syncMissedAt` implement the two-run confirm/miss gate for ingested rows.
- Indexes: `[userId, deadline]`, `[userId, scheduledStartTime]`, `[userId, seriesId, createdAt asc]`, `[userId, scheduleStudyUnitId]`, unique `[userId, externalKey]`.
- `POST /sessions` creates one row, or for a `TASK` with `sessionCount > 1` a series of N rows sharing a `seriesId`.
- See invariant 4 in [AGENTS.md](../../AGENTS.md) and [ADR-0002](../adr/0002-scheduling-simplification.md) section 2.4.
