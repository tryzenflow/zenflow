# Staging load test (issue #77)

k6 against `backend/compose.staging.yml` (prod-like stack + observability + a fake DLU upstream). Unlike the
parent `loadtest/` harness there are no git worktrees or A/B/C variants: it tests whatever image staging builds.
SLOs and results live in [docs/benchmarks](../../docs/benchmarks/2026-10-staging-loadtest.md).

## Stack
`backend/.env.staging` (git-ignored) needs the full API env, see `backend/.env.example`. OTP rate limits are raised
there so one k6 IP can log users in; `LMS_URL` / `PORTAL_API_URL` point at `fake-dlu`, never a real DLU host.
Caps: api 4 CPU / 4 GB, postgres 4 CPU / 8 GB, bandit 2 CPU / 2 GB. Postgres 16 (same major as prod) with `pg_stat_statements`.
Grafana: http://localhost:3000 (admin / `GRAFANA_ADMIN_PASSWORD`, default `admin`). Mail UI: http://localhost:8025.

## Run
Needs k6 >= 1.x on the host, Docker (Colima) with enough CPU/RAM for the caps above plus the o11y stack.

```bash
node loadtest/staging/orchestrate.js up                 # build + start, wait for the API
node loadtest/staging/orchestrate.js seed               # 900 light / 450 medium / 150 heavy users (SEED_*), snapshot (~9 min)
node loadtest/staging/orchestrate.js run smoke          # 1 min; each `run` restores the seed snapshot first
node loadtest/staging/orchestrate.js run full           # ONE ~17 min run: warm-up, 1x/2x/3x holds, ramp-down (--no-sync drops the DLU sync load)
MAX_MULT=8 node loadtest/staging/orchestrate.js run full  # keep stepping up (1x, 2x, ... 8x) to find the breaking point
node loadtest/staging/orchestrate.js run soak           # optional: 15 min at 1x (SOAK_S)
node loadtest/staging/orchestrate.js auth throughput    # OTP burst, raised limits
node loadtest/staging/orchestrate.js auth limits        # shipped OTP limits (compose.staging.shipped-otp.yml): expect 429s
node loadtest/staging/orchestrate.js down               # remove containers and volumes
```

Scale: `CONCURRENT` (250) / `THINK_S` (10) set the 1x rate (25 user actions/s). `full` = 2 min warm-up, then each step ramps for `RAMP_S` (60) and holds `HOLD_S` (240); only the holds are checked against SLOs, tagged `step:1x|2x|3x`.
Output per run in `results/<time>-<profile>/` (git-ignored): `workload.json` (per-step, per-op latency and pass/fail), `sync.json`,
`steps.json` (per step: `docker stats` CPU/memory, server-side p95 by route, fallbacks, pg connections), `containers.json` (whole run),
`pg_stat_statements.txt` (top queries). k6 exits 99 when an SLO threshold fails.

## Files
| File | Role |
| ---- | ---- |
| `slo.js` | SLO table -> per-step k6 thresholds; load profiles (smoke / full / soak) |
| `workload.js` | open-model user mix: week/month reads, schedule task/series, edit, delete, infeasible, settings |
| `sync.js` | background DLU sync load against the fake server |
| `auth.js` | OTP request/verify burst |
| `orchestrate.js` | up / seed / restore / run / auth / down, container + Prometheus + pg snapshots |

## Notes
- cAdvisor only reports the aggregate `/docker` cgroup on Colima's containerd image store, so per-container CPU/memory
  comes from `docker stats` sampling (`containers.json`); Grafana's container panels stay empty here.
- The Prisma pool exposes no metrics: watch `pgConnectionsMax` (postgres-exporter) and `pg_stat_statements`.
- Mailpit is used for OTP mails: `MAIL_KIND=mailpit` in `../scripts/lib.js` (default stays MailHog for the old harness).
