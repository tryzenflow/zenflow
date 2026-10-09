# Backend API reference

For: developers and clients of the Zenflow API. Live schema: Swagger UI at `<API_URL>/api`.

## Conventions

- Prefix `/api/v1`. Every route except `POST /auth/otp/*` needs `CookieAuthGuard` (valid Redis session cookie).
- Success: `{ success: true, message?, data }` (`@zenflow/shared`).
- Error: `{ success: false, message, statusCode?, field? }`.
- `POST /auth/otp/verify` reads the `x-timezone` header.

## Auth (`/auth`)

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/auth/otp/request` | Email a 6-digit OTP. No guard; rate-limited. |
| POST | `/auth/otp/verify` | Verify, create the user if new, start the session. `LocalAuthGuard`; rate-limited. |
| GET | `/auth/me` | Current user. |
| POST | `/auth/logout` | Destroy the session. |

## Users (`/users`)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/users/me` | Profile. |
| PATCH | `/users/update/basic-info` | Update name, timezone, lang, `defaultReminderMinutes`. |
| GET | `/users/me/preference-matrix` | The 168-float matrix for the Insights heatmap. |

- No onboarding endpoint. `timezone` is captured at signup (`x-timezone`) and editable later.
- `defaultReminderMinutes`: 0 = none, default 10 (existing users were migrated to 60).
- Changing `timezone` re-keys each recurring series' `exdates`, so deleted occurrences stay deleted.
- A new signup best-effort seeds 4 daily `DND` blocks (breakfast, lunch, evening, sleep).

## Sessions (`/sessions`)

Drag, resize and reschedule are all `PATCH /sessions/:id` (a `MOVE` signal). There is no status, `/reschedule`, `/resize`, `/optimize` or `/undo`.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/sessions` | Create. `TASK` takes the best free slot (or a materialized series). Fixed/`DND` take the given time and optional `rrule`. |
| GET | `/sessions?view=&date=` | `day`/`week`/`month` window plus unplaced; series fanned to virtual rows. |
| GET | `/sessions/suggestions?q=&limit=` | Title autocomplete, newest first, deduped. |
| GET | `/sessions/deadline-options?anchor=` | The six deadline quick-chip instants. |
| GET | `/sessions/:id` | Detail. Occurrence id: `<seriesId>::<startISO>` (URL-encoded). |
| PATCH | `/sessions/:id` | Metadata, drag/resize, `rrule`, `sessionCount` (grow, shrink, promote). `scope`/`skipConflicting` narrow a series change. |
| DELETE | `/sessions/:id` | Soft-delete; on an occurrence id, adds to `exdates`. |
| DELETE | `/sessions/series/:seriesId` | Delete the whole series. |
| DELETE | `/sessions/series/:seriesId/truncate?from=` | Recurring series: pull `UNTIL` back ("this and following"). |
| DELETE | `/sessions/series/:seriesId/from/:sessionId` | Materialized `TASK` series: delete that sitting and every later one. |
| DELETE | `/sessions/timetable-group/:sessionId[/from]` | Portal-ingested `LECTURE`s only: soft-delete a section's meetings (from a date, or all). |
| POST | `/sessions/:id/slot-pick` | `{ slotProposalId, chose }`: record/apply a pairwise A/B pick. See [ab-testing](../scheduler/ab-testing.md). |

- **Infeasible deadline** (no free slot on create or deadline edit): displacement first repacks flexible tasks on the deadline day (EDF, `SYSTEM_MOVE` events, `displacedSessions[]`).
- If that also fails: `409 SCHEDULE_INFEASIBLE` with `options: ["ACCEPT_CONFLICTS","ACCEPT_LATE_DEADLINE"]`. The client retries with `infeasiblePolicy`.
- Every `Session` carries `late: boolean`.
- **Reminders:** `POST`/`PATCH` accept `reminders?: number[]` (minutes before start, max 2, not for `DND`). Every response carries `reminders: number[]`.
- Omitted on create: one reminder at `defaultReminderMinutes` (non-`DND`; none if 0). Omitted on `PATCH`: unchanged.
- Reminders that are past or under 60 s away are skipped and listed in `skippedReminders`.

## Tags and files

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/tags` | The user's tags for the combobox. |
| POST | `/tags/bulk` | Idempotent bulk create (skips duplicates). |
| POST | `/files/upload` | Multipart, up to 100 MB x 5. |
| POST | `/files/remove` | Delete a file. |
| GET | `/files/metadata/:id` | File metadata. |
| GET | `/files/:id` | Download (API proxies S3). |

- Bytes live in an S3-compatible bucket (`S3_*`). `File.path` is the object key `<userId>/<uuid>`.
- Uploads buffer to `UPLOAD_TMP_DIR`, stream to S3, then are removed.
- **Notes:** `Session.note` stores file refs as `/api/v1/files/<id>` (no `sig`). Every sessions response adds `?sig=` to them; `POST`/`PATCH` strip it and neutralise refs to files the caller does not own.
- The compose `storage` service creates the bucket. Decision: [ADR-0004](../adr/0004-s3-file-storage.md).
- Migrate pre-S3 files: `pnpm migrate:files-to-s3` locally, or `docker compose exec api-<colour> node dist/files/migrate-to-s3.cli.js [--dry-run]`.

## Integrations (`/integrations`)

Stores a student's LMS/portal login for ingestion. Credentials are never returned, only status.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/integrations` | Connect `{ provider, username, password }`: live-login probe, then encrypt + upsert. |
| GET | `/integrations` | `[{ provider, connected, lastVerifiedAt, lastSyncedAt, lastSyncStatus, lastSuccessAt, failing }]`. `lastSyncedAt` is the newest run of any outcome; `lastSuccessAt` is when every data pass last came back clean (oldest of them), the time to show as "last synced"; `failing` is true while a data pass has consecutive failures. |
| PATCH | `/integrations/:provider` | Update credentials (same probe-then-write). |
| DELETE | `/integrations/:provider` | Disconnect. Idempotent; keeps the encryption key. |
| POST | `/integrations/:provider/sync` | Queue this student's fetch jobs and wait up to `SYNC_MANUAL_WAIT_MS`. `200`/`201` with the new status; `202` with the current status and `syncPending: true` if still running. `404` not connected, `409` already running, `429` + `Retry-After` inside the cooldown, `502` if a pass failed, `503 UPSTREAM_UNAVAILABLE` + `Retry-After` while the breaker is open. |

Limits and breaker: [ingestion.md](ingestion.md#manual-sync).

## Notifications (`/notifications`)

The ingestion inbox, written by the materializer, never by a client. `eventName` (a slug like `assignment.created`) is the only machine-readable classification. Clients derive `CREATED`/`UPDATED`/`REMOVED`/`CONFLICT` and category via `@zenflow/shared` helpers.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/notifications?limit=&offset=` | One page, newest first; `unreadCount` covers the whole inbox. |
| PATCH | `/notifications/:id/read` | Stamp `readAt`. |
| PATCH | `/notifications/:id/action-taken` | Stamp `actionTakenAt`. |
| DELETE | `/notifications/:id` | Dismiss (hard delete). |
| POST | `/notifications/:id/reschedule-conflicts` | `*_CONFLICT` rows only: re-place every listed clashing task (EDF). |
| GET | `/notifications/stream` | `@Sse` live feed (web bell, mobile foreground). |
| POST | `/notifications/dev/raise` | Dev only (404 in production): raise fake notifications. |

- Copy follows `User.lang` (`VI_VN` or `EN_US`) for inbox, SSE and push. Rows keep canonical English; known framing is translated on delivery and read.
- Reminder dates and lead times use Vietnamese wording for `VI_VN`. User and upstream titles and locations stay intact.
- OTP emails follow the saved language (new addresses get English). Templates: [`localize-notification.ts`](../../backend/src/notifications/localize-notification.ts).
- SSE crosses processes over Redis pub/sub (`REDIS_PUBSUB_URL`, [ADR-0018](../adr/0018-redis-pubsub-instance.md)): a row raised by a worker reaches clients on any API replica. Delivery is at-most-once; clients refetch the inbox on reconnect.
- `NotificationsService.notify()` publishes to SSE and enqueues one `push` job per provider on the `notify` queue (job id from the row id, so repeats send once; the enqueue is retried and a watcher sweep re-enqueues rows that still have no job). SSE events carry the notification id; clients dedupe by it.
- Exercise inbox, stream and push without a sync: `pnpm --filter backend exec ts-node scripts/send-test-notification.ts <userId> [count]`.

## Devices (`/devices`)

- `POST /devices` registers or refreshes (upsert on `pushToken`). `DELETE /devices` unregisters.
- Push runs as `notify:push` jobs in `worker-notify` (retried with backoff, then `notify.dlq`; `fcm`/`apns` circuit breakers). Each provider self-disables when its env is unset. Dead tokens are pruned on send.

## Rate limits

Built with LimitKit; helper `slidingWindowRule()` in `common/rate-limit/`. Env vars: [config.md](config.md#rate-limits).

| Endpoint | Rule (sliding window) | Over limit |
| --- | --- | --- |
| `POST /auth/otp/request` | per IP 5/min; per IP 20/h (loose for campus NAT); per email 3 per 15 min | `429` |
| `POST /auth/otp/verify` | per IP 20/min; per email 10 per 10 min | `429` |

- OTP email key is normalized (trim, lower-case, `+tag` stripped, Gmail dots dropped) so aliases share a bucket. The address used for login is unchanged.
- Manual sync is not a LimitKit rule: it is a cooldown measured from the schedule's last run, see [ingestion.md](ingestion.md#manual-sync).
- **Fail open:** the rate-limit Redis store is wrapped in `ResilientStore` (`common/rate-limit/resilient-store.ts`).
  - Each call races `RATE_LIMIT_STORE_TIMEOUT_MS` (250). A timeout or error allows the request.
  - Failures feed a `CircuitBreaker` (`common/circuit-breaker.ts`, shared with `PlacementClient`): opens after 5 consecutive failures, probes after 15 s, backs off to 60 s.
  - Warnings are throttled to one per 30 s. Counter `rate_limit.store.fail_open` has a `reason` label.
  - `RATE_LIMIT_REDIS_CLIENT` uses `commandTimeout`, `maxRetriesPerRequest: 1` and no offline queue. The sessions client is unchanged.
  - Tests use the in-memory store, which is not wrapped.
- Store eviction and persistence (`allkeys-lru`, RDB): [ADR-0005](../adr/0005-rate-limit-store-lru-rdb.md).
