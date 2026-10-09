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

A flag that was never toggled (or an unset `REDIS_KILLSWITCH_URL`) is in its normal state: everything on, `maintenance` off. The fail-safe applies only during an outage.

Changes apply within the cache TTL (`KILLSWITCH_CACHE_TTL_MS`, default 5 s) on every process. `ingestion` also respects `INGESTION_ENABLED=false`; either one disables it.

## Use

On the prod/staging host, from the deploy `backend/` directory (wraps `docker compose -f compose.prod.yml exec api-<active colour>`; `ZENFLOW_ENV=staging` for staging). From a laptop, wrap it in SSH: `ssh <host> "cd <deploy-dir>/backend && ./killswitch status"`.

```sh
./killswitch status
./killswitch off notifications FCM outage INC-123     # everything after the flag is the reason
./killswitch on  notifications FCM recovered
./killswitch history 
```

Dev: `pnpm --filter backend killswitch status`. The long form `set <flag> <on|off> --reason "..."` also works. A reason is required. The actor is the OS user, or `KILLSWITCH_ACTOR` if set. `set` fails loudly if Redis is unreachable: the change did **not** apply.

## Audit

Every `set` appends to the Redis stream `killswitch:audit` (flag, value, actor, reason, time) in the same atomic call as the flag write, capped at about 10 000 entries. Read it with `history`. Never `SET killswitch:*` with `redis-cli`: it skips the audit record.

Grafana: **Zenflow · Kill switch** shows current state and flips over time.

## Failure behaviour

- `redis-killswitch` unreachable: every flag takes its fail-safe default above; reads never block a request (250 ms timeout, cached for one TTL).
- Other Redis instances restarting or flushed: flags are unaffected (own instance, `noeviction`, AOF `everysec`, own volume).
- Prod and staging require `REDIS_KILLSWITCH_URL` on every role that reads flags (`api`, `watcher`, `worker-*`).

## Verify after a toggle

1. `list` shows the new value.
2. Wait one TTL, then confirm the effect: ticker logs no enqueues (`ingestion`), `POST` returns 503 (`maintenance`/`signups`), and so on.
3. The Grafana flag state matches.
