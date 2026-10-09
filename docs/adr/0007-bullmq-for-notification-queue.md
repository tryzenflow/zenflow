# ADR-0007: BullMQ, not RabbitMQ, for the notification and ingestion queues

**Status:** accepted
**Date:** 2026-10-09
**Issue:** #80

## Context
- Reminders and push are sent inline from the API process. That is acceptable at launch if failures are logged, but retries, backoff and a dead-letter path are missing.
- Redis (`ioredis`) is already a dependency, and the stack is Node/NestJS.
- Notifications are low-stakes and reminders are re-derivable from `SessionReminder`, so broker-grade durability and complex routing are not needed; at-least-once delivery with deduplication is enough.

## Decision
Use **BullMQ on a dedicated, durable Redis** (`noeviction`, AOF) when the queue is built. Rejected:
- **RabbitMQ:** more power than needed (exchanges, routing keys) at the cost of another stateful service to operate and a heavier client; our routing is "one queue per channel".
- **Kafka:** a log, not a task queue; revisited only for event replay ([ADR-0016](0016-telemetry-retention-and-partitioning.md)).

Queues: `portal-fetch`, `lms-fetch` (the ingestion ticker and manual sync enqueue; see [ingestion.md](../backend/ingestion.md#queues)) and `notify` (push, reminders). Producers live in the API and the watcher; consumers run in the `worker-*` roles ([ADR-0011](0011-separate-api-worker-processes.md)). Every job id is an idempotency key (`idempotencyKey(...)`: `push`/notification+provider, `reminder`/session+start time, `manual`/integration+kind, plus the ticker's per-block key), so BullMQ drops a duplicate `add` while the earlier job is still retained (1 day completed, 7 days failed); rate limits per queue; a dead-letter queue; metrics for depth, failures and latency. Redis placement: [ADR-0008](0008-redis-topology-and-kill-switch.md).

## Consequences
- Native Node tooling, delayed jobs and retries with little code; no new technology class to operate.
- Redis is the single point of failure for queued jobs. Once enqueued, jobs survive restarts (AOF). The residual loss window is an enqueue that fails or times out (`QUEUE_ENQUEUE_TIMEOUT_MS`) while Redis is unreachable: the reminder sweep and the ingestion ticker re-derive and re-enqueue on their next run, but a one-off push is dropped.
- Needs its own Redis instance, because the LRU instances in the topology would evict jobs.
