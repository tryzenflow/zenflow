# ADR-0018: SSE fan-out over a dedicated Redis pub/sub instance

**Status:** accepted
**Date:** 2026-10-09
**Issue:** #133

## Context
- `GET /notifications/stream` (`@Sse`) reads `NotificationsService.notificationEmitter`, an in-process `EventEmitter2`. With several API replicas, or with notifications created in the `watcher` or `worker-*` processes ([ADR-0011](0011-separate-api-worker-processes.md)), the event is emitted in a process that does not hold the client's connection, so it is lost.
- Pub/sub messages are ephemeral; they need no persistence or eviction policy, and a burst must not disturb sessions, flags or the cache.

## Decision
- Add `redis-pubsub` to the compose files: no AOF or RDB, a small `mem_limit`, `REDIS_PUBSUB_URL` in `backend/.env.*`.
- On notification create, publish to a channel; every API process subscribes once and pushes to the SSE connections it holds for that user.
- The API must keep serving requests, and SSE must reconnect and recover, when `redis-pubsub` is down. Messages sent during an outage are not replayed; the notifications inbox endpoint remains the source of truth.
- Metrics: published, delivered, subscriber count. Topology: [ADR-0008](0008-redis-topology-and-kill-switch.md).

## Consequences
- Delivery is at-most-once; clients refetch the inbox on reconnect.
- A restart of this instance drops live subscriptions; processes resubscribe automatically.
- Removes the main blocker for API replicas, the background roles and blue-green ([ADR-0013](0013-blue-green-deploy.md)), where two colours briefly coexist.
