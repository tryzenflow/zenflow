# Backend API reference

For developers and API clients. Live schema: Swagger UI at `<API_URL>/api`.

## Conventions

- Prefix `/api/v1`. Every route except `POST /auth/otp/*` needs `CookieAuthGuard` (Redis session cookie).
- Success: `{ success: true, message?, data }` (`@zenflow/shared`).
- Error: `{ success: false, message, statusCode?, field? }`.
- `POST /auth/otp/verify` reads the `x-timezone` header.

## Auth (`/auth`)

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/auth/otp/request` | Email a 6-digit OTP. Rate-limited. 403 `EMAIL_DOMAIN_NOT_ALLOWED` outside `ALLOWED_EMAIL_DOMAINS` (prod: `dlu.edu.vn`) |
| POST | `/auth/otp/verify` | Verify, create the user if new, start the session. `LocalAuthGuard`, rate-limited |
| GET | `/auth/me` | Current user |
| POST | `/auth/logout` | Destroy the session |

## Users (`/users`)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/users/me` | Profile |
| PATCH | `/users/update/basic-info` | Name, timezone, lang, `defaultReminderMinutes`, `focusBand` (`MORNING`, `AFTERNOON`, `EVENING`, `LATE_NIGHT`; seeds the preference matrix while it is still the default) |
| GET | `/users/me/preference-matrix` | 168-float matrix for the Insights heatmap |
| GET | `/users/me/streak` | Daily completion streak (`Streak`) |
| GET | `/users/me/student` | DLU profile (`StudentResponse`); `profile` is null until the first fetch lands |
| GET | `/users/me/marks` | Marks grouped by term, newest first; names are clean and `noCredit` flags the portal's red star (`StudentMarksResponse`) |
| GET | `/users/me/daily-push` | Morning brief and evening check-in times (`DailyPushSettings`) |
| PUT | `/users/me/daily-push` | Set both times (`HH:mm`, user tz) or `null` to turn one off |

- `timezone` is set at signup (`x-timezone`) and editable. Changing it re-keys recurring `exdates`.
- `defaultReminderMinutes`: 0 none, default 10.
- Signup does not create `DND` blocks. Mobile onboarding creates 3 daily `DND` routines (sleep, lunch break, dinner).

## Sessions (`/sessions`)

Drag, resize and reschedule are all `PATCH /sessions/:id` (a `MOVE` signal).

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/sessions` | Create. `TASK` takes the best free slot (or a materialized series). Fixed and `DND` take the given time and optional `rrule` |
| GET | `/sessions?view=&date=` | `day`, `week` or `month` window plus unplaced. Series fan out to virtual rows |
| GET | `/sessions/suggestions?q=&limit=` | Title autocomplete, newest first |
| GET | `/sessions/search?q=&anchor=&cursor=&direction=&limit=` | Search title, note text, location and tags. Pages by start time from `anchor` (default now) |
| GET | `/sessions/deadline-options?anchor=` | Six deadline quick-chip instants |
| GET | `/sessions/:id` | Detail. Occurrence id: `<seriesId>::<startISO>` (URL-encoded) |
| PATCH | `/sessions/:id` | Metadata, drag, resize, `rrule`, `sessionCount`. `scope` and `skipConflicting` narrow a series change |
| DELETE | `/sessions/:id` | Soft-delete. On an occurrence id, adds to `exdates` |
| DELETE | `/sessions/series/:seriesId` | Delete the series |
| DELETE | `/sessions/series/:seriesId/truncate?from=` | Recurring: pull `UNTIL` back ("this and following") |
| DELETE | `/sessions/series/:seriesId/from/:sessionId` | Materialized `TASK` series: delete that sitting and later ones |
| DELETE | `/sessions/timetable-group/:sessionId[/from]` | Portal `LECTURE`s only: soft-delete a section's meetings |
| POST | `/sessions/:id/pin` | `TASK` only: anchor `PINNED`. The scheduler never moves it |
| DELETE | `/sessions/:id/pin` | Anchor back to `AUTO` |
| POST | `/sessions/placement/confirm` | `{ planId }`: apply a plan the scheduler held for confirmation. Atomic, single use. `201` with `{ session, displacedSessions, undoGroupId }`. `409 PLACEMENT_STALE` when the plan no longer holds |
| POST | `/sessions/undo/:groupId` | Revert every move and create of one undo group. `201` with `{ undoGroupId, restored, removedSessionIds, skippedSessionIds }` |
| POST | `/sessions/:id/slot-pick` | `{ slotProposalId, chose }`: record a pairwise A/B pick ([ab-testing](../scheduler/ab-testing.md)). An `alternative` pick sets the anchor to `CHOSEN` and returns `undoGroupId` |
| POST | `/sessions/:id/complete` | Mark done. Clears skip. Idempotent |
| DELETE | `/sessions/:id/complete` | Undo done |
| POST | `/sessions/:id/skip` | Mark skipped (missed). Clears done. Idempotent |
| DELETE | `/sessions/:id/skip` | Undo skip |

- **Anchors (ADR-0022):** every `Session` carries `anchor` (`AUTO` | `CHOSEN` | `PINNED`) and `anchoredAt`. A drag, "move to" or time pick sets `CHOSEN` on a `TASK`. Pin sets `PINNED`; unpin sets `AUTO`.
- **Placement reason (#254):** `placementReason` (`PREFERRED_HOUR` | `BEFORE_DEADLINE` | `ONLY_FREE_SLOT` | `NEAR_CLASS` | `MOVED_FOR_DEADLINE` | `BEST_AVAILABLE`, or `null`) says why the scheduler picked the start. It is `null` once the start has moved, or for a fallback placement. See [bandit placement](../bandit/placement.md#reason-codes).
- **Confirmation:** a create or deadline change whose only plan moves a `CHOSEN` session is not applied.
  - `POST /sessions` answers `409` with `code: "NEEDS_CONFIRMATION"` and `data.plan` (`{ id, sessionId, start, moves[], expiresAt }`). Confirm with `POST /sessions/placement/confirm`.
  - A deadline `PATCH` answers `200` with `placementPlan` set. The session keeps its start; the deadline is saved.
- **Occurrence move:** `PATCH /sessions/<seriesId>::<startISO>` with `scope: "occurrence"` and a `scheduledStartTime` or `durationMinutes` change excludes that occurrence from the series and returns it as a one-off `Session`. The series keeps its time. Metadata stays series-wide, and a PATCH that also sends `rrule` is a series change.
- **Undo:** each request that moves sessions returns `undoGroupId`. `POST /sessions/undo/:groupId` reverts that group only. A create in the group is removed (soft delete).
- **Sync conflicts:** `POST /notifications/:id/reschedule-conflicts` never moves a `PINNED` task (it stays in `failedSessionIds`) and does not displace a `CHOSEN` one. Its `undoGroupId` covers the call.
- **Infeasible deadline:** displacement repacks flexible tasks on the deadline day (EDF, `SYSTEM_MOVE` events, `displacedSessions[]`).
- If that fails: `409 SCHEDULE_INFEASIBLE` with `options: ["ACCEPT_CONFLICTS","ACCEPT_LATE_DEADLINE"]`. The client retries with `infeasiblePolicy`.
- Every `Session` carries `late: boolean`.
- **Series split:** `sessionDurations` (one 15-minute multiple per session, length `sessionCount`) sets each session's length; `durationMinutes` is then the first one. A day holds at most 3 sittings of a series, 15 minutes apart.
- **Search:** every word of `q` must match, ignoring case and accents (including đ); empty `q` lists all. `direction` is `forward` (start at or after) or `backward` (before); each page is ascending.
- Search returns `{ sessions, nextCursor }`; pass `nextCursor` with the same `direction`. Recurring series add occurrences up to a year past the cursor once stored rows run out. Unscheduled rows are skipped.
- **Done and skipped:** every `Session` carries `completedAt` and `skipped`. Check-off routes return `SessionCheckOffResponse` (`{ session, streak }`) and accept an occurrence id. The representative row id of a recurring series is a 400.
- **Streak:** a day (user tz) counts with at least one completed task. Classes, exams and do-not-disturb never count. Every 7th streak day banks a freeze (max 2); a missed past day spends one, else the streak resets. Today never breaks it.
- **Reminders:** `POST` and `PATCH` accept `reminders?: number[]` (minutes before start, max 2, not for `DND`). Responses carry `reminders: number[]`.
- Omitted on create: one at `defaultReminderMinutes` (none if 0). Omitted on `PATCH`: unchanged.
- Reminders past or under 60 s away are skipped and listed in `skippedReminders`.

## Tags and files

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/tags` | The user's tags |
| POST | `/tags/bulk` | Idempotent bulk create |
| GET | `/course-colours` | The user's course colour picks (`CourseColoursResponse`) |
| PUT | `/course-colours/:courseKey` | Save a pick, `{ swatch }` 0 to 11. Key is `lms:<id>` or `portal:<id>`, URL-encoded |
| DELETE | `/course-colours/:courseKey` | Drop the pick; the course returns to its automatic colour |
| GET | `/files/limits` | `maxFileBytes`, `maxFilesPerRequest`, `userQuotaBytes` |
| GET | `/files/usage` | Limits plus `usedBytes` |
| POST | `/files/upload` | Multipart. Default 20 MB x 5 files, 150 MB per user. 413 `File too large` or `Storage full`. [ADR-0021](../adr/0021-upload-limits.md) |
| POST | `/files/remove` | Delete a file |
| GET | `/files/metadata/:id` | Metadata |
| GET | `/files/:id` | Download (API proxies S3) |

- Bytes live in an S3-compatible bucket (`S3_*`). `File.path` is `<userId>/<uuid>`. Uploads buffer to `UPLOAD_TMP_DIR`, stream to S3, then are removed. [ADR-0004](../adr/0004-s3-file-storage.md).
- **Notes:** `Session.note` stores refs as `/api/v1/files/<id>` without `sig`. Responses add `?sig=`. `POST` and `PATCH` strip it and neutralise refs to files the caller does not own.

## Integrations (`/integrations`)

A student's LMS or portal login for ingestion. Credentials are never returned.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/integrations` | Connect `{ provider, username, password }`: live-login probe, then encrypt and upsert. 400 `STUDENT_ID_MISMATCH` when a `@dlu.edu.vn` account sends a username other than its own student ID |
| GET | `/integrations` | `[{ provider, connected, lastVerifiedAt, lastSyncedAt, lastSyncStatus, lastSuccessAt, failing }]` |
| PATCH | `/integrations/:provider` | Update credentials (same student ID rule, probe, then write) |
| DELETE | `/integrations/:provider` | Disconnect. Idempotent, keeps the encryption key |
| POST | `/integrations/:provider/sync` | Queue fetch jobs and wait up to `SYNC_MANUAL_WAIT_MS` |

- `lastSyncedAt`: newest run, any outcome. `lastSuccessAt`: when every data pass last came back clean (show as "last synced"). `failing`: a data pass has consecutive failures.
- Sync responses: `200` or `201` with status, `202` with `syncPending: true` if still running, `404` not connected, `409` already running, `429` + `Retry-After` in cooldown, `502` a pass failed, `503 UPSTREAM_UNAVAILABLE` + `Retry-After` while the breaker is open.
- Limits: [ingestion.md](ingestion.md#manual-sync).

## Notifications (`/notifications`)

The ingestion inbox, written by the materializer. `eventName` (for example `assignment.created`) is the only machine-readable class. Clients derive `CREATED`, `UPDATED`, `REMOVED`, `CONFLICT` and category with `@zenflow/shared` helpers.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/notifications?limit=&offset=` | Newest first. `unreadCount` covers the whole inbox |
| PATCH | `/notifications/:id/read` | Stamp `readAt` |
| PATCH | `/notifications/:id/action-taken` | Stamp `actionTakenAt` |
| DELETE | `/notifications/:id` | Dismiss (hard delete) |
| POST | `/notifications/:id/reschedule-conflicts` | `*_CONFLICT` rows: re-place every clashing task (EDF) |
| GET | `/notifications/stream` | `@Sse` live feed |
| POST | `/notifications/dev/raise` | Dev only (404 in production) |

- Copy follows `User.lang` (`VI_VN` or `EN_US`) for inbox, SSE, push and OTP email (new addresses get English). Rows keep canonical English and are translated on delivery. Templates: [`localize-notification.ts`](../../backend/src/notifications/localize-notification.ts).
- SSE crosses processes over Redis pub/sub ([ADR-0018](../adr/0018-redis-pubsub-instance.md)). Delivery is at-most-once, so clients refetch on reconnect and dedupe by notification id.
- `NotificationsService.notify()` publishes to SSE and enqueues one `push` job per provider on `notify` (job id from the row id). A watcher sweep re-enqueues rows with no job.
- Test without a sync: `pnpm --filter backend exec ts-node scripts/send-test-notification.ts <userId> [count]`.

## Devices (`/devices`)

- `POST /devices` upserts on `pushToken`. `DELETE /devices` unregisters.
- Push runs as `notify:push` jobs in `worker-notify` (backoff, then `notify.dlq`; `fcm` and `apns` breakers). A provider with no env is disabled. Dead tokens are pruned on send.

## Rate limits

LimitKit, helper `slidingWindowRule()` in `common/rate-limit/`. Env: [config.md](config.md#rate-limits).

| Endpoint | Rule (sliding window) | Over limit |
| --- | --- | --- |
| `POST /auth/otp/request` | IP 5/min and 20/h, email 3 per 15 min | `429` |
| `POST /auth/otp/verify` | IP 20/min, email 10 per 10 min | `429` |

- The email key is normalized (trim, lower-case, `+tag` stripped, Gmail dots dropped).
- Manual sync is a cooldown, not a LimitKit rule: [ingestion.md](ingestion.md#manual-sync).
- **Fail open:** `ResilientStore` (`common/rate-limit/resilient-store.ts`) races each call against `RATE_LIMIT_STORE_TIMEOUT_MS` (250). A timeout or error allows the request.
  - A `CircuitBreaker` (`common/circuit-breaker.ts`) opens after 5 failures, probes after 15 s, backs off to 60 s.
  - Warnings: one per 30 s. Counter `rate_limit.store.fail_open` has a `reason` label.
  - Tests use the in-memory store.
- Eviction and persistence: [ADR-0005](../adr/0005-rate-limit-store-lru-rdb.md).
