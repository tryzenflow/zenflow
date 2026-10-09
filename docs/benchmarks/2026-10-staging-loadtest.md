# Staging load test (#77)

**Run:** 2026-10-05, branch `feat/load-testing`. One full run, no repeats. Raw output: `loadtest/staging/results/<timestamp>-full/` (git-ignored).

## Summary
250 concurrent users (5k registered) met every draft SLO at 1x, 2x and 3x. No errors, dropped iterations or degraded placements. p95 is 5-30x under target because the environment is small and single-host; this is not a production guarantee.

- **Calendar read scans the whole `Session` table.** `WHERE "seriesId" IN (...) ORDER BY "createdAt"` is ~75% of DB time. The only `seriesId` index also starts with `userId`, which the query lacks. Fix first.
- **One Node event loop is the limit.** ELU peaked at 0.75 at 3x using ~1.5 of 4 cores. Capacity above ~3-4x needs more API processes.
- **Heuristic and LinUCB cost the same** because `PAIRWISE_SAMPLE_RATE` is 1 (the default; the A/B pairwise surface needs it), so both run on every placement.
- **DLU sync did not disturb user traffic** at the sparse rate used.

## Environment

| Item | Value |
| --- | --- |
| Host | Apple M1 Max, 64 GB; Colima VM 16 vCPU / 32 GiB, Docker 29.8.1 |
| Load generator | k6 v2.3.0 on the same Mac, outside the VM |
| API | NestJS, Node 20.20 |
| Database | PostgreSQL 16.15 + `pg_stat_statements` (committed stacks now use 18.4; not re-measured) |
| Scheduler | `services/bandit`, `python` placement mode |
| Stack | `backend/compose.staging.yml`: api, bandit, postgres, 2x redis, MinIO, Mailpit, nginx, fake DLU, observability |
| Caps | api 4 CPU / 4 GB, postgres 4 CPU / 8 GB, bandit 2 CPU / 2 GB |
| Data | 1,500 users via the real API (60% light / 30% medium / 10% heavy), 62-day horizon; `Session` = 130,669 rows (25 MB) after the run |

Differences from prod: one host and loopback network, k6 competes for CPU, OTP rate limits raised, fake DLU, no TLS, one API instance, 1,500 users instead of 5,000.

## Method
- **Load:** open model (`ramping-arrival-rate`). 1x = 250 users, one action per 10 s = 25 actions/s.
- **Profile:** 2 min warm-up, 4 min holds at 1x / 2x / 3x with 1 min ramps, 1 min ramp-down (17 min). Only holds are checked.
- **SLOs:** enforced by k6 (`loadtest/staging/slo.js`), draft values. Holds must also deliver >= 98% of planned iterations with no unexpected 4xx/5xx and no failed DLU sync (guards added after this run; it recorded 0 of each).

| Share | Action |
| --- | --- |
| 45% / 15% | Week / month calendar read |
| 15% / 5% | Schedule a task / an 8-sitting series, then re-read |
| 8% / 4% | Edit (move, resize) / delete |
| 2% | Infeasible placement: expect 409, retry with `ACCEPT_CONFLICTS` |
| 6% | Settings |

DLU sync runs in the background at 0.2/s on 200 users (LMS and portal alternating).

| SLI | SLO at 1x | SLO at 2-3x |
| --- | --- | --- |
| Availability (409 not an error) | <= 0.1% | <= 0.5% |
| Calendar read p95, week / month | 300 / 500 ms | 600 / 1000 ms |
| Schedule p95, task / series | 800 / 1500 ms | 1500 / 3000 ms |
| Edit and delete p95 | 400 ms | 800 ms |
| Infeasible 409 p95 | 200 ms | 400 ms |
| Settings p95 | 200 ms | 400 ms |

Sources: k6 (latency, availability, drops), `docker stats` every 15 s (cAdvisor can't see containers on Colima), Prometheus (HTTP, scheduler, Postgres, per step), `pg_stat_statements` (reset at start). Two histograms were added for this test: `scheduler.placement.duration` and `scheduler.placement.python.duration`, tagged `assigned`, `compute_both`, `mode`, `source`.

## Results

45,809 actions, 64,212 requests in 17 min. 0 dropped iterations, unexpected statuses, degraded placements or unavailable responses. **All three steps pass.**

### Latency, client side (p95, ms)

| Operation | SLO 1x / 2-3x | 1x | 2x | 3x |
| --- | --- | --- | --- | --- |
| `GET /sessions` week | 300 / 600 | 12.6 | 16.5 | 40.0 |
| `GET /sessions` month | 500 / 1000 | 16.5 | 20.7 | 45.8 |
| `POST /sessions` task | 800 / 1500 | 67.3 | 85.2 | 166.1 |
| `POST /sessions` series | 1500 / 3000 | 136.4 | 177.5 | 451.3 |
| `PATCH` move | 400 / 800 | 33.8 | 30.6 | 70.7 |
| `PATCH` resize | 400 / 800 | 19.2 | 24.4 | 60.1 |
| `DELETE` | 400 / 800 | 36.1 | 47.7 | 84.4 |
| Infeasible 409 | 200 / 400 | 40.4 | 52.6 | 88.3 |
| `GET /users/me` | 200 / 400 | 8.2 | 10.7 | 24.2 |
| `PATCH` basic-info | 200 / 400 | 10.4 | 12.7 | 29.8 |
| `GET` preference-matrix | 200 / 400 | 7.7 | 10.4 | 24.7 |

p50 / p99 (ms):

| Operation | 1x | 2x | 3x |
| --- | --- | --- | --- |
| Week read | 8.7 / 15.4 | 9.7 / 22.5 | 13.5 / 69.2 |
| Single task | 57.3 / 75.4 | 63.0 / 109.3 | 82.7 / 240.2 |
| Series | 113.6 / 149.2 | 131.6 / 215.7 | 182.3 / 698.2 |

p95 grows 2-3.3x for 3x load. Tails grow faster (series p99 4.7x, week read 4.5x): the first sign of API saturation.

### Resources

| Step | API CPU avg / max | API mem | DB CPU avg / max | Bandit CPU avg / max | PG conns |
| --- | --- | --- | --- | --- | --- |
| 1x | 0.49 / 0.71 | 282 MiB | 0.19 / 0.32 | 0.05 / 0.10 | 10 |
| 2x | 0.89 / 1.25 | 450 MiB | 0.44 / 0.59 | 0.14 / 0.21 | 11 |
| 3x | 1.51 / 1.98 | 515 MiB | 0.78 / 1.15 | 0.21 / 0.31 | 11 |

Event-loop utilisation peaked at 0.75, delay p99 at 43 ms. Caps were never approached. The Prisma pool exposes no metrics, so pool wait is unobserved.

### Server side (p95)

| Endpoint | 1x | 2x | 3x |
| --- | --- | --- | --- |
| `GET /sessions` | 8.5 ms | 9.3 ms | 21.9 ms |
| `POST /sessions` | 211 ms | 217 ms | 249 ms |
| `PATCH /sessions/:id` | 25.0 ms | 24.1 ms | 48.6 ms |
| `DELETE /sessions/:id` | 14.1 ms | 22.7 ms | 45.1 ms |
| `DELETE /sessions/series/:seriesId` | 48.0 ms | 49.3 ms | 99.3 ms |
| `PATCH /users/update/basic-info` | 4.8 ms | 4.9 ms | 10.0 ms |

`GET /users/me` and preference-matrix are <= 5 ms. The 4xx on `POST /sessions` (130 / 239 / 391 per step) are the expected 409s. The smallest HTTP bucket is 5 ms.

### Database
313 s of execution across 431 statements.

| Share | Query | Calls | Mean |
| --- | --- | --- | --- |
| ~75% | `SELECT ... FROM "Session" WHERE "seriesId" IN (...) ORDER BY "createdAt"` | 26,726 | 8.8 ms |
| ~4% | `DELETE FROM "SessionSeries" WHERE id = $1` | 486 | 27.2 ms |
| ~3% | `UPDATE "SlotProposal" SET "sessionId"` | 3,888 | 2.2 ms |

`EXPLAIN (ANALYZE, BUFFERS)` shows a parallel seq scan over all 130,669 rows. `Session_userId_seriesId_createdAt_idx` can't serve it (no `userId` in the query; `session-crud.service.ts`). A property of the code and indexes, not the test data.

### Heuristic vs LinUCB
Assignment is 50/50 (1x: 541 vs 545). Both policies are computed on every request, so latency is the same.

End-to-end single-task placement, p50 / p95 (ms):

| Step | HEURISTIC | LINUCB |
| --- | --- | --- |
| 1x | 23.9 / 47.3 | 24.5 / 47.6 |
| 2x | 34.2 / 49.0 | 34.7 / 49.2 |
| 3x | 40.3 / 88.4 | 40.5 / 90.9 |

Python `/v1/place` p95: 6.6 / 5.5 ms (1x), 9.1 / 9.0 (2x), 13.7 / 13.1 (3x), heuristic / LinUCB. The slot scan dominates; `predict` is below the 1 ms bucket. Python is ~5-14 ms of the 47-90 ms end-to-end; the rest is day-load gathering and Postgres. Every placement was served by Python (no fallback events).

Not measured: heuristic-only vs LinUCB-only cost. A load-test-only rate below 1 reduces pairwise comparisons; production keeps the default of 1.

### DLU sync
204 syncs, 0 failures. LMS p50 0.81 s / p95 0.89 s; portal p50 8.77 s / p95 9.44 s (sequential upstream calls with a 750 ms pause). Excluded from aggregate latency and shown on its own. Last successful sync was 40-50 s old at each step end; no change at 3x.

## Conclusions
1. Launch load through 3x passes every draft SLO with wide margin, for this environment only.
2. Fix the series lookup: add `userId` to the query or index `seriesId`. At 5k users the table is ~3.3x larger (estimate).
3. Run more than one API process (instances or Node cluster behind nginx). Capacity ends around 4x of this load (estimate, untested).
4. To cut placement cost, look at Postgres gather/apply, not the bandit.
5. Sync is safe at a sparse rate; keep it out of aggregate dashboards (done).

## Limits
- One run, no variance known. No stress run beyond 3x or soak; memory is stable only for 17 min.
- Prometheus per-step values end 30 s late, so a few seconds of the next ramp can leak in; k6 numbers are exact.
- Smallest histogram bucket is 1 ms (Python) and 5 ms (HTTP); values at the floor are upper bounds.
- OTP burst was checked separately (verify p95 16 ms at 5 logins/s); prod OTP limits were not exercised.
- Grafana container panels are empty on Colima; container figures come from `docker stats`.

## Follow-ups (not filed)
1. Fix the series lookup; re-measure DB time and 3x tails.
2. Multiple API processes; measure ELU per instance.
3. Prisma pool metrics; `pg_stat_statements` in the staging runbook.
4. Re-run on a prod-sized host with real network and 5k users; revise SLOs.
5. Stand-alone policy cost: load-test only, never a production setting.
6. Breaking point and soak: `MAX_MULT=8 ... run full` (~40 min), `run soak` (15 min at 1x).

## Reproduce
```bash
node loadtest/staging/orchestrate.js up        # build and start the stack
node loadtest/staging/orchestrate.js seed      # ~9 min, 1,500 users, DB snapshot
node loadtest/staging/orchestrate.js run full  # ~20 min incl. restore and metric wait
```
Needs a populated `backend/.env.staging` (git-ignored). Grafana: http://localhost:3000. Options: `loadtest/staging/README.md`.
