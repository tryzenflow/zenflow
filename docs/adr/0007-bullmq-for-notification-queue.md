# ADR-0007: BullMQ, not RabbitMQ, for the notification queue (deferred)

**Status:** accepted (implementation deferred until after launch)
**Date:** 2026-10-09
**Issue:** #80

## Context
- Reminders, push and email are sent inline from the API process. That is acceptable at launch if failures are logged, but retries, backoff and a dead-letter path are missing.
- Redis (`ioredis`) is already a dependency, and the stack is Node/NestJS.
- Losing a queued notification is cheap: a reminder is re-derivable from `SessionReminder` and a missed push is a minor annoyance. We do not need broker-grade durability or complex routing.

## Decision
Use **BullMQ on a dedicated, durable Redis** (`noeviction`, AOF) when the queue is built. Rejected:
- **RabbitMQ:** more power than needed (exchanges, routing keys) at the cost of another stateful service to operate and a heavier client; our routing is "one queue per channel".
- **Kafka:** a log, not a task queue; revisited only for event replay ([ADR-0016](0016-telemetry-retention-and-partitioning.md)).

Producers live in the API; consumers run in the `worker` process ([ADR-0011](0011-separate-api-worker-processes.md)). Idempotency keys on reminder sends; per-channel rate limits; a dead-letter queue; metrics for depth, failures and latency. Redis placement: [ADR-0008](0008-redis-topology-and-kill-switch.md).

Before launch, only keep sends idempotent and log and count failures.

## Consequences
- Native Node tooling, delayed jobs and retries with little code; no new technology class to operate.
- Redis is the single point of failure for queued jobs; a lost job is acceptable (see Context).
- Needs its own Redis instance, because the LRU instances in the topology would evict jobs.
- Not built yet: inline sending stays until the worker split lands and the queue is scheduled.
