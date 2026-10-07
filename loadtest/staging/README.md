# Staging load test (issue #77)

For developers. k6 against `backend/compose.staging.yml` (prod-like stack, observability, fake DLU upstream).
No worktrees or A/B/C variants: it tests whatever image staging builds. SLOs and results: [docs/benchmarks](../../docs/benchmarks/2026-10-staging-loadtest.md).

## Prerequisites

- k6 >= 1.x, Docker (Colima) with CPU/RAM for the caps below plus the observability stack.
- `backend/.env.staging` (git-ignored): the full API env (`backend/.env.example`) plus `GRAFANA_ADMIN_PASSWORD`.
- Raise the OTP rate limits there so one k6 IP can log users in.
- Point `LMS_URL` / `PORTAL_API_URL` at `fake-dlu`, never a real DLU host.

| Service | Cap |
| --- | --- |
| api | 4 CPU / 4 GB |
| postgres 18 (`pg_stat_statements`) | 4 CPU / 8 GB |
| bandit | 2 CPU / 2 GB |

Grafana: <http://localhost:3000> (admin / `GRAFANA_ADMIN_PASSWORD`). Mail UI (Mailpit): <http://localhost:8025>.

## Run

```bash
node loadtest/staging/orchestrate.js up                  # build + start, wait for the API
node loadtest/staging/orchestrate.js seed                # 900 light / 450 medium / 150 heavy users (SEED_*), snapshot (~9 min)
node loadtest/staging/orchestrate.js run smoke           # 1 min; every `run` restores the seed snapshot first
node loadtest/staging/orchestrate.js run full            # one ~17 min run: warm-up, 1x/2x/3x holds, ramp-down
node loadtest/staging/orchestrate.js run full --no-sync  # same without the background DLU sync load
MAX_MULT=8 node loadtest/staging/orchestrate.js run full # keep stepping up (1x..8x) to find the breaking point
node loadtest/staging/orchestrate.js run soak            # optional: 15 min at 1x (SOAK_S)
node loadtest/staging/orchestrate.js auth                # OTP login burst (AUTH_RATE logins/s, default 5)
node loadtest/staging/orchestrate.js down                # remove containers and volumes
```

## Tuning

| Env | Default | Meaning |
| --- | --- | --- |
| `CONCURRENT` / `THINK_S` | 250 / 10 | set the 1x rate (25 user actions/s) |
| `RAMP_S` / `HOLD_S` | 60 / 240 | per step; only holds are checked against SLOs, tagged `step:1x\|2x\|3x` |
| `MAX_MULT` | 3 | highest step multiplier |
| `SOAK_S` | 900 | soak hold length |
| `SEED_LIGHT` / `SEED_MEDIUM` / `SEED_HEAVY` | 900 / 450 / 150 | seeded users per level |

`full` = 2 min warm-up, then one ramp and hold per step. k6 exits 99 when an SLO threshold fails.

## Output

`results/<time>-<profile>/` (git-ignored):

| File | Content |
| --- | --- |
| `workload.json` | per-step, per-op latency and pass/fail |
| `sync.json` | background sync results |
| `steps.json` | per step: `docker stats` CPU/memory, server p95 by route, fallbacks, pg connections |
| `containers.json` | `docker stats` for the whole run |
| `pg_stat_statements.txt` | top queries |

## Files

| File | Role |
| --- | --- |
| `slo.js` | SLO table to per-step k6 thresholds; load profiles (smoke, full, soak) |
| `workload.js` | open-model user mix: week/month reads, schedule task/series, edit, delete, infeasible, settings |
| `sync.js` | background DLU sync load against the fake server |
| `auth.js` | OTP request/verify burst |
| `orchestrate.js` | up, seed, restore, run, auth, down; container, Prometheus and pg snapshots |

## Notes

- cAdvisor reports only the aggregate `/docker` cgroup on Colima, so per-container numbers come from `docker stats` sampling. Grafana container panels stay empty.
- The Prisma pool exposes no metrics: watch `pgConnectionsMax` (postgres-exporter) and `pg_stat_statements`.
- OTP mails use Mailpit: `MAIL_KIND=mailpit` in `../scripts/lib.js` (default stays MailHog for the old harness).
