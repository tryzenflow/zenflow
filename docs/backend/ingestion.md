# DLU ingestion

For: developers on `src/ingestion/`, `lms/`, `portal/`, `integrations/`. Diagram: [ingestion-components.svg](../architecture/ingestion-components.svg). Env vars: [config.md](config.md#dlu-ingestion).

Pulls a student's Moodle assignments/quizzes, class timetable and exam schedule onto their calendar, plus a notification inbox. API-only: no scraping, no headless browser.

## Rules

- **One rolling ticker.** A one-minute heartbeat is the only ingestion trigger. Each integration and kind has its own due time; every tick claims the most overdue batch, spreading load across the day.
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
  - Unrunnable claims are handed back, so rows stay due in original order.
  - `consecutiveFailures` is not bumped, and a run that made no request leaves no job row.
  - The failures that trip the breaker still count against the students who hit them.
- Metrics: `outbound.breaker_state`, `outbound.breaker_short_circuited` (by `upstream`).
- Tuning: `INGESTION_BREAKER_FAILURES` (5), `INGESTION_BREAKER_OPEN_MS` (60000), `INGESTION_BREAKER_MAX_OPEN_MS` (600000).

## Manual sync

`POST /integrations/:provider/sync` ([api.md](api.md#integrations-integrations)).

- Limit: `SYNC_MANUAL_LIMIT` (3) per `SYNC_MANUAL_WINDOW_SEC` (21600 = 6 h) per user + provider. Over: `429` + `Retry-After`.
- A `SET NX EX 120` lock `sync:inflight:{userId}:{provider}` (`integrations/sync-inflight.service.ts`) rejects a concurrent duplicate with `409`.
- Breaker open: `503 UPSTREAM_UNAVAILABLE` + `Retry-After`. The rate-limit slot is already spent (the limiter is a separate guard, deliberately not coupled).
- Redis errors fail open. Details: [api.md](api.md#rate-limits).

Deeper detail (client endpoints, parser rules, semester resolution, job tracking) lives in the `ingestion/` source.
