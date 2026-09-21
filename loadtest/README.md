# Zenflow load test (k6 + Docker): BEFORE vs AFTER-legacy vs AFTER-python

k6 suite that drives the real HTTP API (OTP login through MailHog) against three builds of the
backend, each with every service in a Docker container under identical CPU/memory limits. Results
land in `results/` (git-ignored); the written comparison is [report.html](report.html) (self-contained,
inline CSS/JS/SVG, light/dark).

| Variant | Build | Placement |
| ------- | ----- | --------- |
| `A` BEFORE | `f821194` (last commit before #62) | TS arm-then-minute LinUCB / heuristic, per-day loads |
| `B` AFTER-legacy | HEAD of `feat/issue-60-62` | `SCHEDULER_PLACEMENT_MODE=legacy` (slot-first TS scan); bandit container up so `/predict` is exercised |
| `C` AFTER-python | same HEAD | `SCHEDULER_PLACEMENT_MODE=python`, real `services/bandit` container as `BANDIT_SERVICE_URL` |

The bandit container is up for all three variants (each from its own commit's `services/bandit`).
Each variant is built from its own git worktree (`../zenflow-lt-A|B|C`); the main tree is never touched.

## Layout

```
loadtest/
  Dockerfile.api          API image (build context = a variant's worktree root)
  compose.loadtest.yml    postgres (pg_stat_statements), redis x2, mailhog, bandit, api; explicit limits
  scripts/
    lib.js                OTP login, date helpers, the fixed-load plans (light/medium/heavy)
    seed.js               seeds 50 users per level through the real API; prints session cookies
    run.js                the workload (mix | task | series | infeasible; constant/steady/arrival)
  tools/
    orchestrate.js        seed | run | up | stop | down: passes, alternation, supervisor, heartbeat, docker stats
    keep-awake.sh         caffeinate (macOS) / systemd-inhibit (Linux) / SetThreadExecutionState (Git Bash); power plan untouched
    smoke.js              Nest <-> Python integration smoke test (degraded fallback, shadow mode)
    report.js             results/**/ -> results/summary.json + report.html
  results/                raw output (ignored)
  report.html             the report
```

## Prerequisites

k6 >= 1.7, Docker (Compose v2), Node 20, pnpm 10 (Git Bash on Windows). Build the images once:

```bash
git worktree add --detach ../zenflow-lt-A f821194
git worktree add --detach ../zenflow-lt-B HEAD
git worktree add --detach ../zenflow-lt-C HEAD
for v in A B C; do
  docker build -q -f loadtest/Dockerfile.api -t zf-lt-api:$v ../zenflow-lt-$v
  docker build -q -t zf-lt-bandit:$v ../zenflow-lt-$v/services/bandit
done
```

## Running

```bash
node loadtest/tools/orchestrate.js seed A            # fresh infra + seed light/medium/heavy users (also B, C); makes a pg_dump snapshot
node loadtest/tools/smoke.js C                       # integration smoke test BEFORE any timing (needs `orchestrate.js up C`)
node loadtest/tools/orchestrate.js run               # 3 passes, order A,B,C / C,B,A / B,C,A
node loadtest/tools/orchestrate.js run --passes 1 --variants C --only mix_medium_v10   # a subset
node loadtest/tools/report.js                        # summary.json + report.html
node loadtest/tools/orchestrate.js down A            # remove containers and volumes
git worktree remove ../zenflow-lt-A                  # etc.
```

Each variant-pass starts by restoring the seeded snapshot (`pg_restore`) so no data, bloat or learned
preference carries between passes.

## Resource limits (identical for every variant)

| Service | `--cpus` | `--memory` |
| ------- | -------- | ---------- |
| API (Node 20) | 2 | 2g |
| Python bandit | 2 | 1g |
| Postgres 18 | 2 | 2g |
| Redis (session) | 0.5 | 256m |
| Redis (rate limit) | 0.5 | 256m |
| MailHog (login only) | 0.5 | 512m |

k6 runs on the host (16 logical CPUs, not limited). The Docker VM has 16 CPUs but only ~3.9 GiB of RAM
(`.wslconfig` `memory=4GB`), so the memory limits sum to more than the VM: they are ceilings, and actual
peaks (recorded by `docker stats`) stay far below. Docker Desktop CPU is a CFS quota, so `docker stats`
CPU% is out of 100% per core (API max 200%). Prisma pool size is left at its default.

## Fixed load (the schedules users are seeded with)

Users are `lt-<level>-<n>@example.com` (50 per level). All fixed sessions are created through
`POST /sessions` using the real series model: lectures are weekly `RRULE` series (virtual, one series
per time slot), exams and assignments are one-offs over the next 62 days, in disjoint time bands
(lectures 07:00-16:30, exams 16:45-18:45, assignments 19:00/20:15/21:30, tz Asia/Ho_Chi_Minh).

| Level | Lecture occurrences/week | Exams/week | Assignments/week | Total/week |
| ----- | ------------------------ | ---------- | ---------------- | ---------- |
| light  | 5 (2 rrules)  | ~1 | 2  | ~8  |
| medium | 15 (3 rrules) | 3  | 7  | 25  |
| heavy  | 35 (7 rrules) | 5  | 21 | 61  |

Every user also gets the same deterministic 168-entry `preferenceMatrix` (SQL, after seeding), see
"Integration findings" in the report: a cold-start user (`[]`) is rejected by the Python service with
422 and permanently degrades to the fallback in python mode.

## Scenarios (`SCENARIOS` in `tools/orchestrate.js`)

| Family | Cells | Notes |
| ------ | ----- | ----- |
| headline mix | medium at 1/10/25/50 VUs; light and heavy at 10/50 VUs, 60 s closed loop | list week, task (30 d scan), move, resize, 8-sitting series (30 d), delete |
| scan window | `task` ops at 7/30/60 day deadlines, medium, 10 VUs | |
| series size | `series` ops: 3x/30 d (reference), 8x/30 d, 12x/30 d, 20x/60 d | |
| infeasible | own family, never merged into headline | fixed blocker; AFTER: 409 then policy retry; BEFORE: 400 |
| steady | 5 min, 10 VUs, medium, pass 1 only | drift check, single sample |
| arrival | `ramping-arrival-rate` 1/2/4/8 iterations/s, 20 s each, medium | open model; dropped iterations = saturation |

Recorded per scenario: p50/p95/p99 per operation and overall, throughput, status classes (ok / 409 /
503 / 4xx / 5xx / connection error), `late` / `conflict` / `displaced` / `schedulingDegraded` response
flags, `docker stats` (CPU%, memory) for api/bandit/postgres/redis, `pg_stat_statements` totals (statements
per request) and the top statements, and per-phase `Server-Timing` (`dayload`, `http`, `scan`, `predict`,
`db_apply`; `BENCH_TIMING=1` on B and C, not available in A).

## Reliability of the harness (fixes over run 1)

* Three passes per cell with alternating variant order; the report shows medians and min/max.
* `keep-awake.sh` inhibits sleep for the duration without changing the power plan;
  `results/heartbeat.log` gets a wall-clock line every 3 s. A gap of more than 15 s inside a scenario
  (host sleep or stall) marks it invalid and it is rerun (up to 3 attempts); invalid attempts are kept as
  `*.INVALID.json` and listed in `results/invalid.log` and in the report.
* Supervisor: while k6 runs, the API and bandit containers are inspected every second (status, start time,
  restart count, OOM). A crash aborts k6 at once, invalidates the scenario, restarts the API and reruns.
  Containers use `restart: "no"` so a crash is visible.
* The backlog drain before each scenario is capped at 45 s; if the API has not recovered the scenario is
  invalid and rerun (no 15-minute drains).
* Session cookies are captured at seed time, so a scenario setup only verifies them (`/auth/me`), falling
  back to OTP login.
