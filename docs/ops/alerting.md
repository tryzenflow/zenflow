# Alerting

Grafana-managed rules, provisioned from `backend/observability/grafana/provisioning/alerting/` and emailed through `zenflow-ops-email` (`contact-points.yml`). Backup rules live in [backups.md](backups.md); everything else is `system.yml`. Two older rules sit in Prometheus (`prometheus/rules.d/`): sessions Redis memory and evictions, and session-event partitions.

Thresholds are in the rule files; this table says what each alert means and where to look first.

| Alert | Means | Look at |
| --- | --- | --- |
| API not ready | `/health/ready` fails: Postgres or Redis unreachable, or the API is down | `/health` body (lists failing checks), API logs |
| TLS certificate expires soon | Public certificate under 14 days left (prod only) | certbot container logs |
| High 5xx error ratio | Server errors over 5% of requests | API Overview dashboard, errors panel, slow/failed traces |
| High API latency | p95 over 2 s, sync excluded | API Overview, traces row, outbound client latency |
| Ingestion stale | A provider has had no fully successful sync for 2 h | Ingestion dashboard, watcher error logs (missing key, rejected login) |
| Watcher sign-in errors | Watchers cannot sign in upstream: missing API key, upstream error (stale student passwords do not count) | Ingestion logs, error level: names the missing setting |
| Dead-letter queue not empty | Jobs ran out of retries | Queues dashboard, worker logs |
| Queue wait high | Jobs wait over 60 s before a worker starts | Queues dashboard, worker health |
| Bandit fallback rate high | Over 20% of placements used the heuristic fallback | Scheduler and Bandit dashboard, bandit logs |
| Upstream circuit breaker open | An upstream is failing fast | Outbound latency panels, upstream status |
| Container memory high | A container is over 90% of its limit | API Overview, container memory panel |
| Disk nearly full | Host disk over 85% | `docker system df`, backups and log volume |
| Postgres / Redis exporter down | Exporter not scraped: service or exporter is down | `docker ps`, service logs |

## Behaviour

- Rules evaluate every minute and wait 3 to 30 minutes (`for`) so a deploy restart does not page.
- Ratio, latency and queue rules treat missing data as healthy (no traffic is not an outage). API-not-ready and exporter-down treat it as firing.
- Emails group by alert name, repeat every 4 h and wait 30 s to batch.
- Readiness and TLS come from the blackbox exporter (`prometheus/scrape.d/blackbox*.yml`).

## Adding a rule

Copy a rule in `system.yml` (query, reduce, threshold), keep the summary one plain sentence, and add a row above. Grafana reloads provisioning on restart; compose recreates it on deploy when its mounts change.
