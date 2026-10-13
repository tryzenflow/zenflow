# Kill switch runbook

Disable a subsystem at runtime, no deploy. Design: [ADR-0008](../adr/0008-redis-topology-and-kill-switch.md).

## Flags

| Flag | Off means | Fail-safe default (only while Redis is unreachable) |
| --- | --- | --- |
| `ingestion` | DLU/LMS sync stops: ticker claims nothing, already-queued scheduled fetch jobs are parked (rechecked every 60 s) and resume when back on, manual sync is refused | **off**: protects the upstream portals |
| `notifications` | push and reminder jobs are dropped; reminder sweep pauses | **on** |
| `bandit` | placement uses the frozen TS heuristic | **off**: heuristic is always safe |
| `signups` | new accounts are refused (503); existing users still log in | **on** |
| `maintenance` | every non-GET API request returns 503; `GET` and `/health*` stay up | **off** |

An untoggled flag, or unset `REDIS_KILLSWITCH_HOST`, is normal: everything on, `maintenance` off. Fail-safes apply only during an outage.

Changes apply within `KILLSWITCH_CACHE_TTL_MS` (default 5 s) on every process. `INGESTION_ENABLED=false` also disables `ingestion`.

## Use

Run on the host from the deploy `backend/` directory (`ZENFLOW_ENV=staging` for staging). From a laptop: `ssh <host> "cd <deploy-dir>/backend && ./killswitch status"`.

```sh
./killswitch status
./killswitch off notifications FCM outage INC-123     # everything after the flag is the reason
./killswitch on  notifications FCM recovered
./killswitch history
```

- Dev: `pnpm --filter backend killswitch status`.
- Long form: `set <flag> <on|off> --reason "..."`. A reason is required.
- Actor: the OS user, or `KILLSWITCH_ACTOR`.
- `set` fails if Redis is unreachable. The change did not apply.

## Audit

Every `set` appends to the `killswitch:audit` stream (flag, value, actor, reason, time) atomically, capped near 10 000 entries. Read it with `history`. Never `SET killswitch:*` in `redis-cli`: it skips the audit.

Grafana: **Zenflow Kill switch** shows state and flips.

## Failure behaviour

- `redis-killswitch` unreachable: flags take the fail-safe defaults. Reads time out at 250 ms and cache for one TTL.
- Other Redis restarts or flushes do not affect flags (own instance, `noeviction`, AOF, own volume).
- Prod and staging need `REDIS_KILLSWITCH_HOST` on `api`, `watcher` and `worker-*`.

## Verify after a toggle

1. `list` shows the new value.
2. Wait one TTL, then confirm the effect (no enqueues for `ingestion`, `POST` 503 for `maintenance` and `signups`).
3. The Grafana flag state matches.
