# DLU ingestion

For: developers on `src/ingestion/`, `lms/`, `portal/`, `integrations/`. Diagram: [ingestion-components.svg](../architecture/ingestion-components.svg). Env vars: [config.md](config.md#dlu-ingestion).

Pulls a student's Moodle assignments/quizzes, class timetable and exam schedule onto their calendar, plus a notification inbox. API-only: no scraping, no headless browser.

## Rules

- **One rolling watcher.** A 5 second heartbeat is the only scheduled trigger. Each integration and kind has its own due time; every tick claims the least recently synced batch (never-synced first, at least one student) and splits it into queue jobs. The claim is the at-most-once guard.
- LMS deadlines are checked hourly; timetable and exams daily.
- **Connect** queues two jobs at once: the student profile fetch and enrolment discovery. Nothing waits for the watcher.
- **DKHP discovery** reads a student's registration history once per semester, spread across students. It keeps sections whose latest event is a registration.
  - The watcher claims a timetable row only after discovery covered the current semester (LMS: after any discovery). It never narrows the confirmed set on failure.
- **Exams** are a plain fetch of a rolling window: no cache, no fanout.
- **Idempotent by external key**, student-independent by design. That makes the cross-student cache possible.
- **Confirm/miss gate:**
  - First sighting writes the `Session` at once (visible) but raises no notification until a second consecutive run confirms it.
  - A single miss only flags the item; a second consecutive miss soft-deletes and notifies.
  - A still-unconfirmed item that vanishes is hard-deleted.
- **Upstream wins.** An upstream change always applies; a removal always soft-deletes, even if the student moved the item. Exception: a student's own deletion, which the materializer's `[userId, externalKey]` lookup respects.
- **Write-back** goes only through the materializer, so ingested and user-pinned sessions never drift.

## Flow

[ADR-0024](../adr/0024-split-ingestion-queues.md).

| Step | Queue | Worker does |
| --- | --- | --- |
| Connect | `portal-profile`, `portal-discovery` (LMS: `lms-discovery`) | Profile and study programs; confirmed sections or courses. |
| Profile done | `portal-marks` | Marks per study program, stored on the student. |
| Watcher: discovered, no timetable or stale | `portal-week` | One job per remaining ISO week of the term. |
| Watcher: LMS discovered, calendar stale | `lms-month` | Two jobs: current and next month. |
| Watcher: exams | `portal-fetch` | The whole term in one pass, as before. |

- **Week job:** reads the week from the cache when every confirmed section has fresh coverage for it (`PortalWeekCoverage`, or a term-wide walk watermark), else fetches that week alone. A live fetch is recorded and fanned out to classmates, so their own week jobs resolve from cache. Cancellations are reconciled within that week only.
- **Month job:** reads the month from the cache when every confirmed course is fresh and matches the student's own last view of that month (per-month state in `LmsCourseWindow` and `LmsCourseSeen`), else fetches that month alone. A quiz opened this month and closed next counts as seen, so it is not retired.
- **Run:** a pass over weeks or months is a `SyncRun` with one `SyncRunUnit` per job. Units finish in any order. The job that settles the last one records the schedule outcome; if any unit failed, the claim is handed back. A run whose jobs vanished is closed as failed after 30 minutes.
- **Timetable notice:** week jobs write sessions silently and report how many lectures they created and how many rows they changed. A run raises at most one notice. When the student had no lectures in the term yet, the first week that creates any raises "Sem 1 timetable is live" ("Still syncing, check back soon."), once per student and term, also to classmates reached by fan-out. Otherwise the run raises one notice when it settles, from the summed counts: "3 new lectures" ("A new lecture" for one), or "Your timetable changed" when only edits or removals were found. A transaction-scoped advisory try-lock lets one job write it; a concurrent job skips instead of waiting.
- **Profile and marks:** `StudentProfile`, `StudyProgram`, `StudentMark` and `StudentTermResult` hold normalised fields only. The marks payload repeats phone and birthday on every row, so no raw body is stored. Marks refresh daily; the first time they land the student gets "Your marks are available". Read with `GET /users/me/student` and `GET /users/me/marks` ([api.md](api.md#users-users)).

## Queues

[ADR-0007](../adr/0007-bullmq-for-notification-queue.md), roles in [ADR-0011](../adr/0011-separate-api-worker-processes.md), env in [config.md](config.md#queues-and-sse-fan-out).

- Queues: `portal-fetch`, `portal-profile`, `portal-marks`, `portal-discovery`, `portal-week`, `lms-fetch`, `lms-discovery`, `lms-month`, `notify`. `worker-portal` consumes every `portal-*` queue, `worker-lms` every `lms-*` queue.
- Discovery jobs use `disc_scheduleId_dueAt`, unit jobs `<queue>_runId_unit`, profile and marks jobs carry a day bucket. A repeat enqueue is one job.
- Queue calls are time-bounded (`QUEUE_ENQUEUE_TIMEOUT_MS`). On the first failure the tick hands back its remaining claims and stops.
- **Backpressure:** before claiming a kind, the watcher reads `waiting+delayed` of that kind's queue. At `INGESTION_QUEUE_MAX_BACKLOG` it skips the kind, below it trims the batch (a timetable claim counts as about 25 jobs, a calendar claim as 2). Unclaimed rows keep their `nextDueAt`.
- Each queue runs concurrency 1 per replica. A limiter allows one job start per `INGESTION_REQUEST_DELAY_MS` across replicas (override with `QUEUE_<Q>_RATE_MAX`).
- **Retries:**
  - Unexpected errors retry with backoff. After the last attempt the unit (or schedule row) records the failure and the job goes to `<queue>.dlq`.
  - A pass that reports a failed fetch on `portal-fetch` is recorded as failed and completes: no retry, no DLQ.
  - A stalled scheduled job gets its claim handed back (`onFinalFailure`, compare-and-set).
- **Breaker open:** the job parks for the remaining open time. No attempt used, no failure recorded.
- **Kill switch:** every split queue parks its job for 60 s while ingestion is off, then rechecks.
- **Notifications:** the materializer, conflict detector and run notices create each `Notification` once. `NotificationsService.notify` then enqueues push jobs (id from the row id) and publishes to SSE. A quiet re-run enqueues nothing.
- Without a queue Redis (tests), jobs are recorded but not consumed and manual sync runs inline.

## Cross-student occurrence cache

On in staging and prod (`INGESTION_OCCURRENCE_CACHE_ENABLED`); off by default elsewhere. Timetable meetings and Moodle items are cached once per section or course instead of per student.

- A week or month is served from cache only if discovery is fresh, the confirmed set is non-empty, and every unit was read within `INGESTION_CACHE_TTL_MS` (7 days) for that week or month.
- Past the TTL, one student's live walk refreshes the section and populates every classmate.
- **Divergence guard:** a change is fanned out to classmates only once two different students observed the same transition. A student is served from cache only while their own last live view still matches.
- Measurements: [ingestion-cache-benchmark](../benchmarks/ingestion-cache-benchmark.md) and [`scripts/fixtures/dlu/README.md`](../../backend/scripts/fixtures/dlu/README.md).

## Upstream circuit breaker

- LMS and the portal (DKHP shares the portal's) each have a named breaker from `common/outbound-breaker.ts`, wrapped around the client's single request seam.
- **Opens** after 5 consecutive timeouts, connection errors, 5xx or 429 (login included). 4xx (e.g. wrong password) and parse errors never count.
- **Open:** no request is made (`UpstreamUnavailableError`). After the open time one probe goes out: success closes; failure re-opens with the time doubled up to the max. A `Retry-After` on 429/503 holds it shut at least that long.
- **Students are not penalised:**
  - The watcher stops claiming for that upstream for the rest of the tick; the other upstream continues.
  - Jobs that meet an open breaker are delayed, not failed.
  - `consecutiveFailures` is not bumped, and a run that made no request leaves no job row.
  - The failures that trip the breaker still count against the students who hit them.
- Metrics: `outbound.breaker_state`, `outbound.breaker_short_circuited` (by `upstream`).
- Tuning: `INGESTION_BREAKER_FAILURES` (5), `INGESTION_BREAKER_OPEN_MS` (60000), `INGESTION_BREAKER_MAX_OPEN_MS` (600000).

## Manual sync

`POST /integrations/:provider/sync` ([api.md](api.md#integrations-integrations)).

- **Cooldown:** `SYNC_MANUAL_COOLDOWN_SEC` (900) from the provider's newest `IngestionSchedule.lastRunAt`, so background runs count. Inside it: `429` + `Retry-After`.
- The API enqueues whole-pass fetch jobs on `portal-fetch` / `lms-fetch` (id `manual_{integrationId}_{kind}`, one attempt) and waits up to `SYNC_MANUAL_WAIT_MS` (25 s). A repeat joins the running job.
- Succeeded kinds are pushed out a period. A failed pass (for example no DKHP token) returns `502`. On timeout: `202` with `syncPending: true`.
- A `SET NX EX 120` lock `sync:inflight:{userId}:{provider}` (`integrations/sync-inflight.service.ts`) rejects a duplicate with `409`.
- `503 UPSTREAM_UNAVAILABLE` + `Retry-After` when the API's breaker is open, a manual job is parked behind the workers' breaker, or the queue Redis is unreachable. A parked job runs when the breaker allows.
- Redis errors fail open ([api.md](api.md#rate-limits)).

Client endpoints, parser rules, semester resolution and job tracking: see the `ingestion/` source.

## One-off repairs

- **LMS course link.** Sessions ingested before `Session.lmsCourseId` existed have it null, so their course colour and occurrence fan-out miss them. Link them from `LmsCourseOccurrence`: `pnpm --filter backend backfill:lms-course [--dry-run]`. Idempotent. Rows with no occurrence row stay null.
