# ADR-0011: Separate API, worker and cron/watcher processes

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
- `worker`: no HTTP listener beyond `/health`; runs the crons, ingestion ticker and watchers, materializer, retained-sessions, matrix decay and the retention job ([ADR-0016](0016-telemetry-retention-and-partitioning.md)). One replica, with CPU and memory limits, in the prod and staging compose files.
- SSE fan-out moves to Redis pub/sub ([ADR-0018](0018-redis-pubsub-instance.md)) so the worker and any replica can notify any client.
- Reminders and retained-sessions are verified idempotent before any overlap (deploys briefly run two workers).
- BullMQ is not added yet ([ADR-0007](0007-bullmq-for-notification-queue.md)).

## Consequences
- Jobs fire once regardless of API replica count, and request latency is isolated from sync load.
- The worker is a single point of failure for scheduled work; it restarts unattended and jobs are claim-based.
- Manual sync stays in the API: the watcher/materializer classes load in every role; only the ticker, crons and reminder timers are worker-only. API edits reach reminder timers on the worker's next 5-minute sweep.
- New env `ROLE`, a `worker` service, a split of module wiring in `app.module.ts` and `main.ts`.
