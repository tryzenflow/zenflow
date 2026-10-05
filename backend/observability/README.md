# Observability stack (traces · metrics · logs)

Receives, stores and visualises telemetry (issue #53). App-side instrumentation: `../src/observability/`, `../src/tracing.ts`, `services/bandit/src/otel.py`.

```
              OTLP/HTTP :4318                         scrape :8889
 API ──────────────┐                    ┌──────────────────────────── Prometheus ──┐
 bandit ───────────┼──► OTel Collector ─┼──► Tempo (traces) ──(service graph +     │
                   │                    │        span metrics, remote_write) ──────┤
 container stdout ─┼─► Alloy ──► Loki ◄─┴──► (app OTLP logs, future)               │
                   │                                                                ▼
 host / cgroups ───┴─► node-exporter + cAdvisor ──────────────────────────────► Grafana :3000
```

## Run it

### Staging / local — `compose.staging.yml`

```bash
docker compose --env-file .env.staging -f compose.staging.yml up -d --build
```

Same images and configs as production, plus:
- `postgres-exporter` (connections, locks, `pg_stat_*`), scraped via `prometheus/scrape.d/postgres-exporter.yml` (staging only).
- A fake DLU upstream for the load test ([loadtest/staging/README.md](../../loadtest/staging/README.md)).

`.env.staging` must set `GRAFANA_ADMIN_PASSWORD`. Grafana (<http://localhost:3000>) and Mailpit bind to `127.0.0.1`. Dashboards are in the **Zenflow** folder; **Explore** has Tempo, Loki and Prometheus wired.

cAdvisor sees only the aggregate `/docker` cgroup when the image store is containerd's (Colima, recent Docker Engine); see the `cadvisor` service comment.

### Production — `compose.prod.yml`

Same images and configs, folded into the main stack. `.env.prod` must set
`OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318` and
`GRAFANA_ADMIN_PASSWORD`. Grafana binds to `127.0.0.1:3000` only (anonymous access
**off**) — reach it with an SSH tunnel or a Caddy route with auth.

## What's here

| Path                                        | What                                                                          |
| ------------------------------------------- | ---------------------------------------------------------------------------- |
| `otel-collector-config.yaml`                | OTLP in → Tempo (traces) / Prometheus exporter :8889 (metrics) / Loki (logs) |
| `prometheus/prometheus.yml`                 | scrapes the collector, node-exporter, cAdvisor, the stack itself             |
| `tempo/tempo.yaml`                          | local storage, 48h retention, metrics-generator → Prometheus remote-write    |
| `loki/loki-config.yaml`                     | single-binary, filesystem, 7d retention, OTLP ingest on                      |
| `alloy/config.alloy`                        | Docker-SD log scrape; lifts `level` → label and `traceId` → structured metadata for the JSON services |
| `grafana/provisioning/datasources/`         | Prometheus + Tempo + Loki, cross-linked (trace↔logs↔metrics, exemplars)      |
| `grafana/provisioning/dashboards/`          | file provider → the JSON below                                              |
| `grafana/dashboards/zenflow-api-overview.json`     | HTTP RED, outbound clients RED, runtime/container USE, push & SSE, logs |
| `grafana/dashboards/zenflow-scheduler-bandit.json` | proposals/policy/fallback/arms, session events, rewards, move-drag heatmap, cron, Python bandit latency |
| `grafana/dashboards/zenflow-ingestion.json`        | blocks by outcome (redundant-work %), upstream items, reconcile deletes, freshness, watcher logs |

## Metric name mapping

Instruments use OTel dot-notation (`http.server.request.duration`). The collector's
`prometheus` exporter rewrites to snake_case + unit + `_total`, e.g.

| Instrument                             | Prometheus                                        |
| ------------------------------------- | ------------------------------------------------ |
| `http.server.request.duration` (s)   | `http_server_request_duration_seconds_{bucket,count,sum}` |
| `scheduler.proposals`                 | `scheduler_proposals_total`                       |
| `scheduler.cron.duration` (s)         | `scheduler_cron_duration_seconds_bucket`          |
| `ingestion.last_success.timestamp` (s)| `ingestion_last_success_timestamp_seconds`        |
| `bandit.update.duration` (s)          | `bandit_update_duration_seconds_bucket`           |
| `bandit.linucb.cold_arms`             | `bandit_linucb_cold_arms_{sum,count}`             |

`service.name` / `service.version` / `deployment.environment.name` ride along as
labels (`resource_to_telemetry_conversion`).

## Known gaps (issue #53 follow-ups — panels stay empty until these land)

- `ingestion_last_success_timestamp` gauge, `ingestion_upstream_items_total`,
  `ingestion_blocks_total` `type` label → *Ingestion* freshness / upstream panels.
- `scheduler_session_events_total`, `scheduler_session_move_drag_minutes`,
  `scheduler_reward_updates_total` → *Scheduler & Bandit* rows 2–3.
- Node.js runtime metrics (`nodejs_eventloop_*`, heap/RSS) — wired only if
  `@opentelemetry/instrumentation-runtime-node` is active → *API Overview* USE row.
- App OTLP **logs** (pino → collector) — the `logs` pipeline is wired but nothing
  sends yet; today logs reach Loki only via Alloy scraping stdout.
