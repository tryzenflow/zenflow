# Staging load test, issue #77

Run date: 2026-10-05. Code: branch `feat/load-testing` at `cbaf302` plus uncommitted working-tree changes (the placement instrumentation described below). One full run, no repeats.

This document is self-contained: environment, method, results, conclusions and caveats. Raw output of the run is in `loadtest/staging/results/<timestamp>-full/` (git-ignored).

## 1. Summary

Under a model of 250 concurrent users (5k registered), the staging stack met every draft SLO at 1x, 2x and 3x of that load. There were no errors, no dropped iterations and no degraded placements. The margins are large (p95 is 5 to 30 times under target), because this environment is small and single-host and the dataset is small. Do not read the headroom as a production guarantee.

What matters more than the pass:

1. **The calendar read does a full-table scan.** Three Postgres queries of the form `WHERE seriesId IN (...) ORDER BY createdAt` account for about 75% of all database time. They scan the whole `Session` table on every calendar read, because the only `seriesId` index also starts with `userId` and the query has no `userId`. Cost therefore grows with total table size, not with the user's own data. This is the first thing to fix (section 5).
2. **The API is a single Node process and was about 75% busy at 3x.** Event-loop utilisation peaked at 0.75. Its CPU cap (4 cores) is not the limit; one event loop is. Capacity above roughly 3-4x needs more API processes, not more cores.
3. **Heuristic vs LinUCB latency is identical today, by design.** `PAIRWISE_SAMPLE_RATE` is 1, so every placement runs both algorithms and the A/B roll only chooses which result is applied. The stand-alone cost of each policy was not measured (section 4.6).
4. **DLU sync did not disturb user traffic** at the sparse rate used, and took 0.8 s (LMS) and 8.8 s (portal) per sync by design.

## 2. Environment

### 2.1 Host and runtime

| Item | Value |
| --- | --- |
| Machine | Apple M1 Max, 64 GB RAM, macOS |
| Docker | Colima VM, 16 vCPU / 32 GiB, Docker 29.8.1, containerd image store |
| Load generator | k6 v2.3.0 on the same Mac, outside the VM |
| API | NestJS, Node 20.20, image built from this working tree |
| Database | PostgreSQL 16.15 (same major as prod) with `pg_stat_statements` |
| Scheduler | Python bandit service (`services/bandit`), the `python` placement mode |

### 2.2 Stack (`backend/compose.staging.yml`)

api, bandit, postgres, redis (sessions) and redis-ratelimit, MinIO storage, Mailpit (mail), Caddy (HTTP reverse proxy), a fake DLU upstream, and the observability stack (OpenTelemetry collector, Tempo, Loki, Alloy, Prometheus, Grafana, cAdvisor, node-exporter, postgres-exporter).

Resource caps, set so no service can starve another: api 4 CPU / 4 GB, postgres 4 CPU / 8 GB, bandit 2 CPU / 2 GB. Other services are uncapped.

### 2.3 Data

1,500 users seeded through the real API: 900 light, 450 medium, 150 heavy (60/30/10%). Each user has a fixed schedule: weekly lecture series (2 / 3 / 7 series for light / medium / heavy), plus exams and assignments over a 62-day horizon (about 8 / 25 / 61 fixed items per week). After the run the `Session` table held 130,669 rows (25 MB), which is the seed plus this run's leftovers. Every run restores the seed snapshot first.

### 2.4 Differences from production

- One host, loopback networking. The issue asked for real network hops; there are none here.
- k6 shares the Mac with the VM, so the load generator competes for CPU.
- OTP rate limits are raised (otherwise one IP cannot log users in). They were checked separately with the shipped values.
- DLU is a fake server (`scripts/fake-dlu-server.ts`), never the real university.
- Plain HTTP through Caddy, no TLS. A single API instance. Prod hardware is unknown.
- 1,500 users, not 5,000.

## 3. Method

### 3.1 Load model

Open model (`ramping-arrival-rate`): users arrive independently of response time, so slowness shows up as dropped iterations or latency rather than a slower client. 1x is 250 concurrent users, one action per 10 s each, which is **25 user actions per second**. One action is one iteration on a random seeded user.

Action mix:

| Share | Action | Calls |
| --- | --- | --- |
| 45% | Calendar, week view | `GET /sessions?view=week&date=` |
| 15% | Calendar, month view | `GET /sessions?view=month&date=` |
| 15% | Schedule a task | `POST /sessions` (TASK + deadline), then re-read the week |
| 5% | Schedule a series | `POST /sessions` with `sessionCount: 8`, then re-read the month |
| 8% | Edit | `PATCH /sessions/:id` (move or resize) |
| 4% | Delete | `DELETE /sessions/:id` or `/sessions/series/:id` |
| 2% | Infeasible placement | blocker + unmeetable task, expect 409, retry with `ACCEPT_CONFLICTS` |
| 6% | Settings | `GET /users/me`, `PATCH /users/update/basic-info`, `GET /users/me/preference-matrix` |

In the background, DLU sync (`POST /integrations/:provider/sync`) runs at 0.2 per second against the fake server, alternating LMS and portal, on 200 users who connected fake credentials first. It is sparse on purpose: a sync is a long call, and in production syncs are driven by sequential crons.

### 3.2 Profile: one run, three load steps

2 min warm-up to 1x, then 4 min holds at 1x, 2x (50/s) and 3x (75/s) joined by 1 min ramps, then a 1 min ramp-down: 17 minutes. Every request is tagged with the step it ran in. Only the hold periods are checked against the SLOs; warm-up, ramps and ramp-down are not.

### 3.3 SLOs (draft)

The thresholds are enforced by k6, so a failed SLO exits the run with code 99.

| SLI | SLO at 1x | SLO at 2-3x |
| --- | --- | --- |
| Availability (status 0 or >=500; the expected 409 is not an error) | <= 0.1% | <= 0.5% |
| Calendar read p95, week / month | 300 / 500 ms | 600 / 1000 ms |
| Schedule p95, single task / series | 800 / 1500 ms | 1500 / 3000 ms |
| Edit and delete p95 | 400 ms | 800 ms |
| Infeasible-placement 409 p95 | 200 ms | 400 ms |
| Settings p95 | 200 ms | 400 ms |

The numbers are initial guesses informed by an older benchmark, not commitments. They are fixed in `loadtest/staging/slo.js`.

### 3.4 What was measured, and where from

- **Client side (k6):** latency per operation and per step, availability, dropped iterations.
- **Containers:** CPU and memory sampled from `docker stats` every 15 s (cAdvisor cannot see individual containers on Colima's containerd image store).
- **Server side (Prometheus):** HTTP latency by method and route, scheduler metrics, and Postgres connections, evaluated per step. Latency by assigned policy comes from two histograms added for this test: `scheduler.placement.duration` (end-to-end single placement) and `scheduler.placement.python.duration` (per phase, as the Python service reports it), tagged `assigned` (HEURISTIC or LINUCB), `compute_both`, `mode` and `source`.
- **Database:** `pg_stat_statements`, reset at the start of the run.

## 4. Results

### 4.1 Overall

45,809 user actions and 64,212 HTTP requests in 17 minutes (63 requests/s on average, about 1.4 requests per action). 0 dropped iterations, 0 unexpected statuses, 0 degraded placements, 0 unavailable responses in any step. 19 delete actions found nothing to delete (counted as no-ops). **All three steps PASS.**

### 4.2 Latency by step (client side, p95 in ms, p50 and p99 below)

| Operation | SLO 1x / 2-3x | 1x p95 | 2x p95 | 3x p95 |
| --- | --- | --- | --- | --- |
| `GET /sessions` week | 300 / 600 | 12.6 | 16.5 | 40.0 |
| `GET /sessions` month | 500 / 1000 | 16.5 | 20.7 | 45.8 |
| `POST /sessions` single task | 800 / 1500 | 67.3 | 85.2 | 166.1 |
| `POST /sessions` series (8 sittings) | 1500 / 3000 | 136.4 | 177.5 | 451.3 |
| `PATCH` move | 400 / 800 | 33.8 | 30.6 | 70.7 |
| `PATCH` resize | 400 / 800 | 19.2 | 24.4 | 60.1 |
| `DELETE` | 400 / 800 | 36.1 | 47.7 | 84.4 |
| Infeasible 409 | 200 / 400 | 40.4 | 52.6 | 88.3 |
| `GET /users/me` | 200 / 400 | 8.2 | 10.7 | 24.2 |
| `PATCH` basic-info | 200 / 400 | 10.4 | 12.7 | 29.8 |
| `GET` preference-matrix | 200 / 400 | 7.7 | 10.4 | 24.7 |

p50 / p99 for the operations that matter most:

| Operation | 1x p50 / p99 | 2x p50 / p99 | 3x p50 / p99 |
| --- | --- | --- | --- |
| Week read | 8.7 / 15.4 | 9.7 / 22.5 | 13.5 / 69.2 |
| Single task | 57.3 / 75.4 | 63.0 / 109.3 | 82.7 / 240.2 |
| Series | 113.6 / 149.2 | 131.6 / 215.7 | 182.3 / 698.2 |

From 1x to 3x (3x the load), p95 rises about 2 to 3.3x, roughly linear. The tails grow faster: p99 of the series placement rises 4.7x and the week read 4.5x. That widening is the first visible sign of the API process nearing saturation (4.3).

### 4.3 Resources by step

| Step | API CPU avg / max (cores) | API memory max | DB CPU avg / max | DB memory | Bandit CPU avg / max | Postgres connections (max) |
| --- | --- | --- | --- | --- | --- | --- |
| 1x | 0.49 / 0.71 | 282 MiB | 0.19 / 0.32 | 222 MiB | 0.05 / 0.10 | 10 |
| 2x | 0.89 / 1.25 | 450 MiB | 0.44 / 0.59 | 226 MiB | 0.14 / 0.21 | 11 |
| 3x | 1.51 / 1.98 | 515 MiB | 0.78 / 1.15 | 229 MiB | 0.21 / 0.31 | 11 |

Over the whole run the API's event-loop utilisation peaked at 0.75 and event-loop delay p99 peaked at 43 ms. API CPU grows by about 0.5 core per 1x. Caps (4 / 4 / 2 cores) were never approached. Connection counts are well below any pool limit; the Prisma pool itself exposes no metrics, so pool wait could not be observed directly.

### 4.4 Server side, by method and route (p95)

Server-side view from Prometheus. `GET /sessions` and `POST /sessions` are separate series, and the sync route is excluded (section 4.7).

| Endpoint | 1x | 2x | 3x |
| --- | --- | --- | --- |
| `GET /sessions` (week and month) | 8.5 ms | 9.3 ms | 21.9 ms |
| `POST /sessions` (single and series together) | 211 ms | 217 ms | 249 ms |
| `PATCH /sessions/:id` | 25.0 ms | 24.1 ms | 48.6 ms |
| `DELETE /sessions/:id` | 14.1 ms | 22.7 ms | 45.1 ms |
| `DELETE /sessions/series/:seriesId` | 48.0 ms | 49.3 ms | 99.3 ms |
| `GET /users/me`, `/me/preference-matrix` | <= 5 ms | <= 5 ms | <= 5 ms |
| `PATCH /users/update/basic-info` | 4.8 ms | 4.9 ms | 10.0 ms |

The 4xx responses on `POST /sessions` (130 / 239 / 391 per step) are the expected infeasible-placement 409s, about 2% of actions. The histogram's smallest bucket is 5 ms, so values at or below it are not resolved.

### 4.5 Database

Top queries by total time, from `pg_stat_statements` (313 s of execution time across 431 statements in total):

| Share of DB time | Query | Calls | Mean |
| --- | --- | --- | --- |
| about 75% together | `SELECT ... FROM "Session" WHERE "seriesId" IN ($1..$n) ORDER BY "createdAt" ASC OFFSET $n` (n = 2, 3 or 7) | 26,726 | 8.8 ms |
| about 4% | `DELETE FROM "SessionSeries" WHERE id = $1` | 486 | 27.2 ms |
| about 3% | `UPDATE "SlotProposal" SET "sessionId"` | 3,888 | 2.2 ms |

The list sizes 2, 3 and 7 match the number of lecture series for light, medium and heavy users, so this is the per-request series lookup in the calendar read. `EXPLAIN (ANALYZE, BUFFERS)` on a sample shows a **Parallel Seq Scan over the whole `Session` table** (130,669 rows, about 2,800 shared buffers per call in `pg_stat_statements`, 3,260 in the EXPLAIN sample, 43,555 rows filtered per worker). The existing index `Session_userId_seriesId_createdAt_idx` cannot serve it because the query has no `userId`. This is a consequence of the code path (`session-crud.service.ts`) and the index list, not of the test data.

### 4.6 Heuristic vs LinUCB

Assignment is a 50/50 coin flip per placement. Counts split evenly (1x: 541 heuristic, 545 LinUCB). `PAIRWISE_SAMPLE_RATE` is 1, so for **every** request the Python service computed both policies; the assignment only chooses which result is applied. Latency is therefore expected to be the same, and it is.

End-to-end single-task placement (gather, Python, apply, persist), p50 / p95 in ms:

| Step | HEURISTIC | LINUCB |
| --- | --- | --- |
| 1x | 23.9 / 47.3 | 24.5 / 47.6 |
| 2x | 34.2 / 49.0 | 34.7 / 49.2 |
| 3x | 40.3 / 88.4 | 40.5 / 90.9 |

Python `/v1/place` (`mode=PLACE`), p95 in ms:

| Step | Total (H / L) | Scan | Round trip | Predict, context, decode, displace |
| --- | --- | --- | --- | --- |
| 1x | 6.6 / 5.5 | 4.9 | 9.9 | <= 1 |
| 2x | 9.1 / 9.0 | 6.5 / 6.8 | 16.7 | <= 1 |
| 3x | 13.7 / 13.1 | 9.4 / 9.6 | 23.3 | <= 1 |

LinUCB scoring (`predict`) is at or below the histogram's lowest bucket (1 ms), so its exact cost is below what these histograms can resolve. The slot scan dominates the Python time. Python's total is a small part of the end-to-end placement (about 5-14 ms of 47-90 ms p95); the rest is gathering day loads and applying and persisting in Postgres. Every placement was served by Python (source `python`); no fallback events fired.

**Not measured:** the stand-alone cost of a heuristic-only request vs a LinUCB-only request. That needs `PAIRWISE_SAMPLE_RATE=0` (the knob now exists; section 6).

### 4.7 DLU sync (background)

204 syncs in 17 minutes (about 0.2/s), 0 failures. LMS: p50 0.81 s, p95 0.89 s. Portal: p50 8.77 s, p95 9.44 s. The portal sync is slow by design: it makes sequential upstream calls with a fixed 750 ms pause between them. Because the route is slow by definition, it is excluded from the aggregate latency numbers above and reported on its own; the Prometheus p95 for it was about 9.5 s. At the end of each step the age of the last successful sync was 40-50 s, so ingestion kept up. The 3x step shows no change in sync latency.

## 5. Conclusions

1. **Within this environment, launch load and 2-3x passes every draft SLO with wide margin, with no errors.** That satisfies "no errors or regressions at 2-3x" for this setup only; it is not proof for production hardware.
2. **Fix the series lookup before launch.** Every calendar read triggers a full scan of `Session`. At the 130k rows measured it costs about 8.8 ms of DB time per call and is 75% of all DB time. At 5k users the table will be about 3.3x larger (estimate: the same sessions per user as here), so expect the scan, and the DB CPU it drives, to grow with it. The fix is small: add `userId` to that query, or index `seriesId` on its own.
3. **Plan for more than one API process.** At 3x the event loop was 75% busy while only about 1.5 of 4 allowed cores were used. A single Node process will not use the cores it is given. From one data point, capacity would run out somewhere around 4x of this load (estimate; not tested). Run several API instances, or Node cluster mode, behind Caddy.
4. **The heuristic and LinUCB cost the same while both are computed on every placement.** If the aim is to reduce cost, the placement path to examine is the Postgres gather/apply work, not the bandit.
5. **Sync is safe at a sparse rate** and its long calls must stay out of aggregate latency dashboards (done: the dashboards now exclude it and show it in its own panel).

## 6. Limits of this run

- One run, no repeats, so no run-to-run variance is known.
- 3x is not the breaking point. Neither a stress run beyond 3x nor a 15-minute soak at 1x was done. Memory was stable only for the 17 minutes measured.
- k6 shares the host with the VM, the network is loopback, there is one API instance, and 1,500 users stand in for 5,000.
- Prometheus values per step are taken over the hold window ending 30 s late (to let metrics arrive), so a few seconds of the next ramp can leak in. The k6 numbers (section 4.2) are the exact per-step figures.
- Histogram resolution: the smallest bucket is 1 ms for the Python phases and 5 ms for HTTP, so values at the floor are upper bounds.
- The OTP burst and shipped-limit behaviour were validated separately and briefly (verify p95 16 ms at 5 logins/s; with shipped limits 5 of 61 requests from one IP were allowed and the rest got 429). They were not part of this run.
- Grafana's container panels stay empty on Colima (cAdvisor limitation); container CPU and memory here come from `docker stats`.
- The Prisma connection pool exposes no metrics, so pool saturation could not be observed.

## 7. Recommended follow-ups

Not filed yet; each is a candidate issue.

1. Series lookup in the calendar read: add `userId` to the query or an index on `seriesId`; re-measure DB time and the 3x tails.
2. Run more than one API process; measure event-loop utilisation per instance.
3. Add Prisma pool metrics, and Postgres `pg_stat_statements` to the staging runbook.
4. Re-run on a real staging host sized like prod, with real network hops and 5k users, then confirm or revise the SLOs.
5. Heuristic-only vs LinUCB-only latency: `PAIRWISE_SAMPLE_RATE=0 node loadtest/staging/orchestrate.js run full`.
6. Breaking point and soak: `MAX_MULT=8 node loadtest/staging/orchestrate.js run full` (about 40 minutes) and `run soak` (15 minutes at 1x).
7. Decide whether `PAIRWISE_SAMPLE_RATE=1` should stay in production, given it makes every placement compute both policies.

## 8. What changed in the code for this test

- `backend/compose.staging.yml`: observability stack merged in from `compose.observability.yml`, fake DLU, Postgres 16 with `pg_stat_statements`, postgres-exporter, resource caps, Mailpit, and a `PAIRWISE_SAMPLE_RATE` pass-through. `compose.staging.shipped-otp.yml` restores the shipped OTP limits for the auth check.
- `backend/src/observability/metrics.ts`, `scheduler/io/placement-gateway.service.ts`, `scheduler/io/python-placer.service.ts`: the two placement histograms. `scheduler/constants.ts`: `PAIRWISE_SAMPLE_RATE` can be overridden by an environment variable (clamped to 0-1, default 1, so production behaviour is unchanged).
- Grafana: API Overview now groups by method and route, pins HTTP queries to the app's own series (OpenTelemetry's auto-instrumentation emits the same metric a second time without a `route` label, which doubled every sum), excludes the sync route from aggregates and shows it separately. Scheduler & Bandit has a new "Placement latency — heuristic vs LinUCB" row.
- `loadtest/staging/`: the harness. `loadtest/scripts/lib.js`: Mailpit support (`MAIL_KIND=mailpit`), MailHog stays the default.

## 9. Reproduce

```bash
node loadtest/staging/orchestrate.js up        # build and start the stack
node loadtest/staging/orchestrate.js seed      # about 9 min, 1,500 users, takes a DB snapshot
node loadtest/staging/orchestrate.js run full  # this run: about 20 min including restore and metric wait
```

Needs a populated `backend/.env.staging` (git-ignored). Grafana is at http://localhost:3000. See `loadtest/staging/README.md` for options.
