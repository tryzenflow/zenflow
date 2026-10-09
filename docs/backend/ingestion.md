# DLU ingestion

For: developers on `src/ingestion/`, `lms/`, `portal/`, `integrations/`. Diagram: [ingestion-components.svg](../architecture/ingestion-components.svg). Env vars: [config.md](config.md#dlu-ingestion).

Pulls a student's Moodle assignments/quizzes, class timetable and exam schedule onto their calendar, plus a notification inbox. API-only: no scraping, no headless browser.

## Rules

- **One rolling ticker.** A one-minute heartbeat is the only scheduled trigger. Each integration and kind has its own due time; every tick claims the most overdue batch (the claim is the at-most-once guard) and enqueues it, spreading load across the day.
- LMS deadlines are checked hourly; timetable and exams daily.
- **DKHP discovery** reads a student's registration history once per semester, spread across students. It keeps sections whose latest event is a registration.
  - It must succeed for the current semester before any timetable fetch; if not, it runs inline.
  - It never narrows the confirmed set on failure.
- **Exams** are a plain fetch of a rolling window: no cache, no fanout.
- **Idempotent by external key**, student-independent by design. That makes the cross-student cache possible.
- **Confirm/miss gate:**
  - First sighting writes the `Session` at once (visible) but raises no notification until a second consecutive run confirms it.
  - A single miss only flags the item; a second consecutive miss soft-deletes and notifies.
  - A still-unconfirmed item that vanishes is hard-deleted.
- **Upstream wins.** An upstream change always applies; a removal always soft-deletes, even if the student moved the item. Exception: a student's own deletion, which the materializer's `[userId, externalKey]` lookup respects.
- **Write-back** goes only through the materializer, so ingested and user-pinned sessions never drift.

## Queues

[ADR-0007](../adr/0007-bullmq-for-notification-queue.md), roles in [ADR-0011](../adr/0011-separate-api-worker-processes.md); env in [config.md](config.md#queues-and-sse-fan-out).

- The `watcher` role's ticker enqueues one job per claim: portal kinds (timetable, exam, discovery) to `portal-fetch`, LMS kinds to `lms-fetch`. Job id is `scheduleId_dueAt`, so enqueueing a slot twice is one job. Every queue call is time-bounded (`QUEUE_ENQUEUE_TIMEOUT_MS`): on the first failure the tick hands back all its remaining claims and stops, and `running` is always reset.
- **Backpressure:** before claiming a kind the ticker reads its queue's `waiting+delayed`; at `INGESTION_QUEUE_MAX_BACKLOG` it skips the kind, below it trims the batch to the headroom. Rows that cannot run are never claimed, so their `nextDueAt` is not pushed out.
- `worker-portal` / `worker-lms` run the pass (`ingestion-fetch.service.ts`), concurrency 1 per replica. Replicas are not sequential with each other, so each fetch queue has a default limiter of one job start per `INGESTION_REQUEST_DELAY_MS` across all replicas (override with `QUEUE_<Q>_RATE_MAX`). It spaces pass starts, not the requests inside concurrent passes.
- **Retries:** an unexpected error is retried with exponential backoff; on the last attempt the schedule row records the failure and the job lands in `<queue>.dlq`. A pass that ran and reported a failed fetch (including upstream timeouts or 5xx before the breaker opens) is recorded as a failed pass and the job completes: no retry, no DLQ. Backoff and the DLQ apply only to unexpected (non-upstream) errors and to a job that stalls past its limit. A stalled scheduled job also gets its claim handed back (`onFinalFailure`, a compare-and-set, so repeats on several replicas are harmless). A retry re-runs the same idempotent pass and the outcome is recorded once.
- **Breaker open:** the job is parked for the breaker's remaining open time without using an attempt, and no failure is recorded.
- **Digest-loss window:** sessions are written during the walk but notifications are raised from the digest at the end. A worker killed in between loses that pass's notifications (the retry sees no change). Accepted; the calendar itself is correct.
- **Notifications:** the materializer and conflict detector create each `Notification` row once, then `NotificationsService.notify` enqueues its push jobs (job id from the row id) and publishes to SSE. Nothing is sent inline, and a quiet re-run enqueues nothing.
- Without a queue Redis (tests) jobs are recorded but not consumed; manual sync runs inline.

## Cross-student occurrence cache

Off by default (`INGESTION_OCCURRENCE_CACHE_ENABLED`). Timetable meetings and Moodle items are cached once per section or course instead of per student.

- A pass is served from cache only if discovery is fresh, the confirmed set is non-empty, and every unit was read within `INGESTION_CACHE_TTL_MS` (7 days) and covers the term.
- Past the TTL, one student's live walk refreshes the section and populates every classmate.
- **Divergence guard:** a change is fanned out to classmates only once two different students observed the same transition. A student is served from cache only while their own last live view still matches.
- Measurements: [ingestion-cache-benchmark](../benchmarks/ingestion-cache-benchmark.md) and [`scripts/fixtures/dlu/README.md`](../../backend/scripts/fixtures/dlu/README.md).

## Upstream circuit breaker

- LMS and the portal (DKHP shares the portal's) each have a named breaker from `common/outbound-breaker.ts`, wrapped around the client's single request seam.
- **Opens** after 5 consecutive timeouts, connection errors, 5xx or 429 (login included). 4xx (e.g. wrong password) and parse errors never count.
- **Open:** no request is made (`UpstreamUnavailableError`). After the open time one probe goes out: success closes; failure re-opens with the time doubled up to the max. A `Retry-After` on 429/503 holds it shut at least that long.
- **Students are not penalised:**
  - The ticker stops claiming for that upstream for the rest of the tick; the other upstream continues.
  - Fetch jobs that meet an open breaker are delayed, not failed.
  - `consecutiveFailures` is not bumped, and a run that made no request leaves no job row.
  - The failures that trip the breaker still count against the students who hit them.
- Metrics: `outbound.breaker_state`, `outbound.breaker_short_circuited` (by `upstream`).
- Tuning: `INGESTION_BREAKER_FAILURES` (5), `INGESTION_BREAKER_OPEN_MS` (60000), `INGESTION_BREAKER_MAX_OPEN_MS` (600000).

## Manual sync

`POST /integrations/:provider/sync` ([api.md](api.md#integrations-integrations)).

- Cooldown: `SYNC_MANUAL_COOLDOWN_SEC` (900 = 15 min) from the provider's newest `IngestionSchedule.lastRunAt`, so a background run counts as much as a manual one. Inside it: `429` + `Retry-After`.
- The API enqueues the same fetch jobs (job id `manual_{integrationId}_{kind}`, one attempt) and waits up to `SYNC_MANUAL_WAIT_MS` (25 s). A repeat while one is still running joins it.
- The job itself pushes the kinds that succeeded out a period and counts a failed kind; a failed pass (e.g. no DKHP token) makes the request `502`. If the wait expires the reply is `202` with `syncPending: true` and the job finishes in the background.
- A `SET NX EX 120` lock `sync:inflight:{userId}:{provider}` (`integrations/sync-inflight.service.ts`) rejects a concurrent duplicate with `409`.
- `503 UPSTREAM_UNAVAILABLE` + `Retry-After` when the API's own breaker peek is open (only in a process that also makes calls), when a manual job is found parked (`delayed`) behind the workers' breaker, either on a repeat press or noticed by the 1 s poll while waiting, or when the queue Redis is unreachable (every queue call is time-bounded). A parked job stays queued and runs when the breaker allows.
- Redis errors fail open. Details: [api.md](api.md#rate-limits).

Deeper detail (client endpoints, parser rules, semester resolution, job tracking) lives in the `ingestion/` source.
