# ADR-0011: Separate API, watcher and worker processes

**Status:** accepted
**Date:** 2026-10-09
**Issue:** #132

## Context
- Every API process currently runs everything: `ScheduleModule.forRoot()` and the crons (ingestion ticker every minute, reminders every 5 min, retained sessions every 30 min, matrix decay at 03:00), the DLU/LMS watchers and the materializer.
- With N API replicas each job would run N times, and the CPU-heavy sync work competes with requests on one event loop (ELU was already 0.75 at 3x load, [ADR-0009](0009-load-test-follow-ups.md)).
- The notification SSE stream reads an in-process `EventEmitter2`, so work done in another process never reaches connected clients.

## Decision
One image, a `ROLE` env:
- `api`: HTTP only, no `ScheduleModule`, no cron or watcher providers. Run 2-3 processes behind nginx.
- `watcher`: serves only `/health`; the sole cron runner (ingestion ticker, reminder sweep, retained-sessions, matrix decay, retention job, [ADR-0016](0016-telemetry-retention-and-partitioning.md)). It enqueues and consumes nothing. Exactly one replica, with CPU and memory limits, in the prod and staging compose files.
- `worker-portal`, `worker-lms`, `worker-notify`: `/health` only; each consumes one BullMQ queue (`portal-fetch`, `lms-fetch`, `notify`; [ADR-0007](0007-bullmq-for-notification-queue.md)) and scales by replicas. `worker` (watcher plus every consumer) and `all` (everything incl. HTTP, the default) exist for single-process dev and tests.
- SSE fan-out moves to Redis pub/sub ([ADR-0018](0018-redis-pubsub-instance.md)) so the worker and any replica can notify any client.
- Reminders and retained-sessions are verified idempotent before any overlap (deploys briefly run two of each role).
- Worker containers get `stop_grace_period: 60s` so in-flight jobs drain (`QUEUE_SHUTDOWN_TIMEOUT_MS`, 50 s).

## Consequences
- Jobs fire once regardless of API replica count, and request latency is isolated from sync load.
- The watcher is a single point of failure for scheduled work; it restarts unattended and the sweeps are idempotent.
- Manual sync is enqueued by the API and run by the fetch workers; the API waits briefly for the result. Only the ticker, crons and reminder sweep are watcher-only.
- New env `ROLE`, `watcher` and `worker-*` services, a split of module wiring in `app.module.ts` and `main.ts`.
