# Staging load test after the `seriesId` index (#130)

**Run:** 2026-10-09, branch `alphatrann/perf-db-fix-the-session-seriesid-seq-scan-and-fi` merged with `master` (blue-green stack). One full run, no repeats. Baseline: [2026-10-staging-loadtest.md](2026-10-staging-loadtest.md). Raw output: `loadtest/staging/results/2026-10-09T14-28-21-895Z-full/` (git-ignored).

## Summary
The `Session.seriesId` seq scan is gone: the query that took ~75% of DB time (313 s total) is no longer among the top 15 statements, and the largest one is now `DELETE FROM "SessionSeries"` at 14.8 s. The workload passes all three steps with 0 unexpected statuses and 0 degraded placements. The k6 sync run exited 99, and the 3x tails are worse than the baseline; both are unexplained by this change (see below).

- **Fix:** index `(seriesId, createdAt)` plus `where: { userId }` on the first-session includes (`day-load.ts`, `series.service.ts`).
- **Comparison is not like for like.** The baseline ran one API container; this run has three replicas, and the new stack, queues and workers.
- **Hold results are not a clean A/B.** Master changed under the test (blue-green, queue consumers), so latency deltas are indicative only.

## Results

### Latency, client side (p95, ms)

| Operation | Baseline 1x / 2x / 3x | This run 1x / 2x / 3x |
| --- | --- | --- |
| Week read | 12.6 / 16.5 / 40.0 | 14.9 / 17.9 / 32.1 |
| Month read | 16.5 / 20.7 / 45.8 | 21.7 / 23.8 / 37.7 |
| Task schedule | 67.3 / 85.2 / 166.1 | 63.4 / 73.6 / 130.9 |
| Series schedule | 136.4 / 177.5 / 451.3 | 139.9 / 162.8 / 287.1 |
| `PATCH` move | 33.8 / 30.6 / 70.7 | 40.3 / 32.2 / 48.2 |
| `DELETE` | 36.1 / 47.7 / 84.4 | 34.9 / 44.6 / 68.7 |

45,742 iterations, 64,245 requests, 67 dropped iterations (0.15%, inside the 98% delivery guard).

p99 at 3x is much worse: week read 1,004 ms (baseline 69 ms) and series 5,947 ms (baseline 698 ms). p50 is flat (12 ms, 139 ms). Cause not isolated.

### Database
Top statements by total time (`pg_stat_statements`, reset at start):

| Query | Calls | Total | Mean |
| --- | --- | --- | --- |
| `DELETE FROM "SessionSeries" WHERE id = $1` | 432 | 14.8 s | 34.2 ms |
| `UPDATE "SlotProposal" SET "sessionId"` (FK action) | 3,456 | 13.8 s | 4.0 ms |
| `SELECT COUNT(*) ... "SessionEvent"` | 47,257 | 6.0 s | 0.13 ms |
| `SELECT ... FROM "Session"` (four listed) | 63,183 | 17.2 s | 0.16-0.67 ms |

The two top rows were already in the baseline (27.2 ms and 2.2 ms means) and are now slower per call. `SlotProposal."sessionId"` is probably unindexed; not checked.

### Server side (p95)
`GET /sessions` 9.8 / 10.0 / 23.3 ms, `POST /sessions` 185 / 210 / 241 ms, `DELETE /sessions/series/:id` 48 / 49 / 96 ms. PG connections peaked at 28 / 31 / 32 (baseline 10-11).

### DLU sync
The sync k6 process failed its threshold: 205 syncs, 26% "failed" (`sync_failed: rate==0`). They were not errors. `POST /integrations/:provider/sync` returned `202 syncPending` when the job outlasted `SYNC_MANUAL_WAIT_MS` (25 s); the harness counts any non-200/201 as a failure. Portal syncs now take p50 25.0 s (baseline 8.8 s); LMS p50 0.94 s (baseline 0.81 s). No error or warn lines in the API, `worker-portal` or `worker-lms` logs. The sync is now queued through `worker-portal` / `worker-lms`, so the harness expectation is stale and the portal slowdown needs its own look.

## Limits
- Three API replicas, but nginx points at `api-blue:8000`. In the 1x step one replica averaged 0.28 cores and the others ~0.02, so load likely landed on one container (docker DNS resolved once). Treat the 3x tails with that in mind.
- `api-green` and `bandit-green` were started by the harness's `up` and sat idle.
- One run, no variance known. Postgres version, host and caps match the baseline's stack file, not its measured environment.
- The scheduler session/reward/drag metrics added in this branch were not in the running image, so those Grafana panels were not exercised.

## Follow-ups (not filed)
1. Make the sync harness treat `202 syncPending` as pending and poll for completion; then re-measure portal sync.
2. Pin the nginx upstream to all replicas (or run one) and rerun to settle the 3x tails.
3. Check `SlotProposal."sessionId"` and `SessionSeries` delete cost.
4. Rebuild the image and rerun `smoke` to confirm the new scheduler metrics reach Grafana.

## Reproduce
```bash
node loadtest/staging/orchestrate.js up
node loadtest/staging/orchestrate.js seed
node loadtest/staging/orchestrate.js run full
```
