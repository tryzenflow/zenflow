# Observability stack (traces, metrics, logs)

For developers and operators. Receives, stores and visualises telemetry (issue #53).
App-side instrumentation: `../src/observability/`, `../src/tracing.ts`, `services/bandit/src/otel.py`.

```
 API, bandit ──OTLP/HTTP :4318──► OTel Collector ──► Tempo (traces) ──► Prometheus (span metrics, remote_write)
                                       │──► Prometheus exporter :8889 ──► Prometheus ──► Grafana :3000
 container stdout ──► Alloy ──► Loki ────────────────────────────────────────────────► Grafana
 host / cgroups ──► node-exporter + cAdvisor ──► Prometheus
```

## Run it

| Stack | Command | Env |
| --- | --- | --- |
| Staging / local | `docker compose --env-file .env.staging -f compose.staging.yml up -d --build` | `GRAFANA_ADMIN_PASSWORD` |
| Production | folded into `compose.prod.yml` | `GRAFANA_ADMIN_PASSWORD`, `OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318` |

- Run from `backend/`. Compose defaults the Grafana password to `admin` when unset; always set it.
- Grafana (<http://localhost:3000>) binds to `127.0.0.1` in both stacks; anonymous access is off.
- Production: reach Grafana through an SSH tunnel or an authenticated nginx route.
- Dashboards are in the **Zenflow** folder. **Explore** has Tempo, Loki and Prometheus wired.
- Staging adds `postgres-exporter` (scrape file `prometheus/scrape.d/postgres-exporter.yml`) and a fake DLU upstream for [the staging load test](../../loadtest/staging/README.md).
- cAdvisor sees only the aggregate `/docker` cgroup on containerd image stores (Colima, recent Docker Engine); see the `cadvisor` service comment.

## What is here

| Path | What |
| --- | --- |
| `otel-collector-config.yaml` | OTLP in; Tempo (traces), Prometheus exporter :8889 (metrics), Loki (logs) |
| `prometheus/prometheus.yml` | scrapes the collector, node-exporter, cAdvisor and itself |
| `tempo/tempo.yaml` | local storage, 48h retention, metrics-generator to Prometheus remote-write |
| `loki/loki-config.yaml` | single binary, filesystem, 7d retention, OTLP ingest on |
| `alloy/config.alloy` | Docker-SD log scrape; `level` becomes a label, `traceId` structured metadata |
| `grafana/provisioning/datasources/` | Prometheus, Tempo, Loki, cross-linked (trace, logs, metrics, exemplars) |
| `grafana/provisioning/dashboards/` | file provider for the dashboards below |
| `grafana/dashboards/zenflow-api-overview.json` | HTTP RED, outbound clients RED, runtime/container USE, push and SSE, logs |
| `grafana/dashboards/zenflow-scheduler-bandit.json` | proposals, policy, fallback, arms, session events, rewards, move-drag heatmap, cron, bandit latency |
| `grafana/dashboards/zenflow-ingestion.json` | blocks by outcome, upstream items, reconcile deletes, freshness, watcher logs |

## Metric names

Instruments use OTel dot notation. The collector's Prometheus exporter rewrites to snake_case, adds the unit and `_total`.
Names and labels are an API: update the dashboards with them. Definitions: `../src/observability/metrics.ts`.

| Instrument | Prometheus |
| --- | --- |
| `http.server.request.duration` (s) | `http_server_request_duration_seconds_{bucket,count,sum}` |
| `scheduler.proposals` | `scheduler_proposals_total` |
| `scheduler.cron.duration` (s) | `scheduler_cron_duration_seconds_bucket` |
| `ingestion.last_success.timestamp` (s) | `ingestion_last_success_timestamp_seconds` |
| `bandit.update.duration` (s) | `bandit_update_duration_seconds_bucket` |
| `bandit.linucb.cold_arms` | `bandit_linucb_cold_arms_{sum,count}` |

`service.name`, `service.version` and `deployment.environment.name` become labels (`resource_to_telemetry_conversion`).

## Known gaps

- Node.js runtime metrics (`nodejs_eventloop_*`, heap, RSS) appear only if `@opentelemetry/instrumentation-runtime-node` is active; otherwise the *API Overview* USE row stays empty.
- App OTLP logs (pino to collector): the `logs` pipeline is wired but nothing sends. Logs reach Loki only via Alloy scraping stdout.
