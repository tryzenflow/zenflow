# Zenflow Bandit Service

A small Python service hosting the **Disjoint LinUCB** model that personalizes Zenflow's
task scheduling. Linear algebra is a poor fit for the NestJS/TypeScript backend, so the
model lives here and the API calls it over internal HTTP (`BANDIT_SERVICE_URL`).

Design: [`docs/adr/0001-linucb-model-design.md`](../../docs/adr/0001-linucb-model-design.md).
Arm → timestamp mapping: [`docs/scheduler/reranking.md`](../../docs/scheduler/reranking.md).
Experiment: [`docs/scheduler/ab-testing.md`](../../docs/scheduler/ab-testing.md).

> **Status: wired end to end.** The model core, offline replay evaluator and FastAPI
> surface (`src/api.py`: `GET /health`, `POST /predict`, `POST /update`) are implemented
> and tested; the NestJS backend calls this service as **Policy B** in a 50/50 A/B against
> the preference heuristic (Policy A). `BanditPlacer` (`backend/src/scheduler/io/bandit-placer.service.ts`)
> builds the context and picks the slot; `BanditService` + `BanditArmStateRepository`
> (`backend/src/bandit/`) own the HTTP calls and `(A, b)` persistence;
> `SchedulingFeedbackService` sends the delayed reward. With `BANDIT_SERVICE_URL` unset,
> every scheduling event falls back to Policy A.

## Design

- **Disjoint LinUCB.** Each of the 5 time-of-day arms keeps its own ridge regression
  `A = λI + Σ xxᵀ`, `b = Σ r·x` over a context vector shared across arms, scored by
  `θ̂ᵀx + α·√(xᵀA⁻¹x)`. `λ = 1.0`, `α = 0.15` (ADR-0001 §10). `A⁻¹` is cached per arm and
  invalidated on update. The `LinUCB` class is arm-agnostic — arms are created lazily by
  string key at the ridge prior — so the same code serves 3 arms (the offline demo) or 5
  (production).
- **Canonical arms** (`SchedulingArm` in `@zenflow/shared`), half-open, lower-inclusive:
  `EARLY_MORNING [00:00,06:00)`, `MORNING [06:00,11:00)`, `AFTERNOON [11:00,17:00)`,
  `EVENING [17:00,20:00)`, `NIGHT [20:00,24:00)`.
- **Context vector** `d = 22` — session (`remaining_days_until_deadline`, `duration`),
  candidate day (`day_of_week[7]`, `candidate_days_from_now`, `workload_by_type[10]`,
  `semester_phase`), bias. No preference-matrix input. Full table and normalization:
  ADR-0001 §5.
- **Stateless service.** This service holds **no per-user state**. The NestJS backend owns
  `(A, b)` persistence (Postgres table `BanditArmState`, ADR-0001 §6.1) and passes the 5
  arms' `(A, b)` in every request; `/update` returns the new `(A, b)` for the backend to
  persist. This keeps all durable state in one database and makes the "fall back to the
  heuristic when the service is down" path trivial.
- **Reproducible.** The only randomness is uniform tie-breaking from an injected
  `random.Random` — no `Math.random()`, no clock reads, no module-global RNG
  (mirrors the scheduler-core invariant in [`CLAUDE.md`](../../CLAUDE.md)).

## HTTP surface

| Route           | Purpose                                                                                  |
| --------------- | -------------------------------------------------------------------------------------- |
| `GET /health`   | Liveness probe → `{"status":"ok"}`.                                                      |
| `GET /ready`    | Readiness: numpy import, tz offset-cache warm-up and a self-test placement → `200 {"status":"ready"}` or `503`. Compose healthcheck target. |
| `POST /v1/place` | **Authoritative placement** (ADR-0003) — see below. |
| `POST /predict` | Body: `alpha`, `ridge`, `state` (all 5 arms' `(A, b)`, `[]` = cold ridge prior), `contexts` (`[{day, x}]`). Returns `{scores: {day: {arm: score}}}` — all 5 arms for every day. A cold arm scores `0.0` (no exploration bonus until it has data). |
| `POST /update`  | Body: `ridge`, `arm`, `x`, `reward`, `state` (that arm's `(A, b)`, `[]` = cold). Returns the new `{A, b}` (`A` is `d*d` row-major). |

### `POST /v1/place` (ADR-0003, phase 2 - not yet called by Nest until phase 3)

One request = one placement event (a single `TASK`, or one materialized series). The
service builds the context vector and the 5 arm scores **in-process** from the supplied
`(A, b)` (no `/predict` hop), then runs the heuristic and, when `primaryPolicy`/`computeBoth`
needs it, the slot-first LinUCB scan. Contract types: `packages/shared/src/placement.ts`
(mirrored by `src/schemas_place.py`, `extra="forbid"`, camelCase, epoch-ms ints,
`contractVersion: 1`); example pairs: `packages/shared/contract/place/*.json`.

- **Per member** (`src/place.py`): scan window = local days `[start, deadline]` (single,
  capped by `maxScanDays`) or the series' non-overlapping window from `series_day_windows`
  (`daySpan = min(floor((deadline - next15)/1d), 59)`); days already holding
  `MAX_SERIES_PER_DAY` (=1) siblings are skipped and siblings' intervals are hard blocks
  (sibling ledger). HEURISTIC = best per-day preference slot, best score across days (earlier
  day wins ties). LINUCB = slot-first scan over all days with the adaptive wL/wP blend. A
  LINUCB primary without bandit state / with a singular matrix / no surviving slot falls back
  to the heuristic pick (`appliedPolicy: "HEURISTIC"`).
- **Response fields** `heuristic` / `linucb` are present iff requested (primary or
  `computeBoth`; heuristic also when it is the LINUCB fallback); `startMs` is the applied
  policy's pick and feeds the ledger. `mode: "PREFLIGHT"` runs the heuristic only.
- **No free slot, single member**: call 1 -> `NEEDS_INFEASIBLE_CONTEXT`; call 2 (with
  `infeasible`) -> EDF displacement over the deadline day (widening to +/-1 day) ->
  `DISPLACED` with `moves`; otherwise the user's policy: `ACCEPT_CONFLICTS` ->
  `ACCEPTED_CONFLICTS` (min-overlap start; `conflicting` is true iff it really overlaps
  `horizonOccupied`), `ACCEPT_LATE_DEADLINE` -> `ACCEPTED_LATE` (`late: true`); else
  `INFEASIBLE`. A series member with no slot is reported `INFEASIBLE` (no displacement,
  siblings still placed - TS series parity).
- **Errors**: `422` validation (FastAPI `detail` list); `422 {"code":"CONTRACT_VERSION",
  "supported":1,"got":n}` for a foreign `contractVersion`; `413` > 2 MB; `401` bad/missing
  bearer token.
- **Auth**: set `BANDIT_SERVICE_TOKEN` to require `Authorization: Bearer <token>` on
  `/v1/place`, `/predict`, `/update` (`hmac.compare_digest`; `BANDIT_SERVICE_TOKEN_PREVIOUS`
  is also accepted for rotation). Unset -> open (dev/tests). `/health` and `/ready` are exempt.
- **Observability**: every response carries `x-request-id` (echoing the inbound header, else
  `req-<n>`); each place call logs `request_id=<body requestId> ... outcomes=... total_ms=`.
  `paramsVersion` = `py-` + sha256 of all core constants (+ contract version), stored by Nest as
  `SlotProposal.modelVersion`. `timingsMs = {decode, context, predict, scan, displace, total}`
  (decode = body parse/validation; total includes it).
- **Deterministic**: no randomness, no clock (`nowMs` is a field); same body -> same picks.

**Latency** (`uv run python -m scripts.bench_place`; Windows dev box, single process,
`TestClient` round trip = JSON + validation + handler, no network; one 90 min task, 30-day
scan, Europe/Paris, 6-14 occupied blocks/day, 200 runs, ADR target p99 < 400 ms):

| Case                              | Payload | Round trip p50 / p95 / p99 | Handler total p50 / p95 | Scan p50 / p95 |
| --------------------------------- | ------- | -------------------------- | ----------------------- | -------------- |
| HEURISTIC primary                 | 70 KB   | 7.0 / 14.3 / 29.3 ms       | 4.6 / 11.8 ms           | 1.9 / 2.2 ms   |
| LINUCB primary (warm state)       | 70 KB   | 8.6 / 16.7 / 19.4 ms       | 5.9 / 14.0 ms           | 2.8 / 3.1 ms   |
| computeBoth (LINUCB primary)      | 70 KB   | 10.7 / 16.6 / 29.9 ms      | 7.9 / 14.1 ms           | 4.6 / 5.0 ms   |
| computeBoth, dense (14 blocks/day)| 83 KB   | 12.1 / 19.3 / 37.0 ms      | 8.7 / 15.2 ms           | 4.9 / 5.7 ms   |

`scripts/gen_place_fixtures.py` regenerates the Python-owned contract fixtures (LinUCB,
pairwise, cold bandit, displacement, accepted-conflicts/late); review their diff like a golden
update. `tests/test_place.py` (behaviour/auth/errors), `tests/test_place_contract.py` (every
fixture + golden TS `bestFreeSlot`/`bestLinucbSlot` through `/v1/place`).

`d` is inferred from the length of `x` and validated (all `x` equal; each non-empty `A` is
`d*d`, each non-empty `b` is `d`); bad shapes / non-finite values / `alpha < 0` /
`ridge <= 0` / an unknown `arm` → HTTP 422.

Reward values (ADR-0001 §7): `RETAINED → +1`; `MOVE → −clamp(|dragDistanceMinutes| / 240, 0, 1)`;
resize-only `MOVE` (`dragDistanceMinutes == 0`) → `0`. `CREATE` is never sent.

## Toolchain

Managed with [uv](https://docs.astral.sh/uv/) (Python 3.12). This service is **not** a
pnpm workspace — run its commands from `services/bandit/`.

```powershell
uv sync                      # create .venv and install deps (incl. dev group)
uv run pytest                # unit tests
uv run ruff check .          # lint
uv run ruff format .         # format
uv run mypy                  # typecheck (strict)
uv run python -m src.main    # replay-evaluation demo: LinUCB vs. random baseline
uv run uvicorn src.api:app --reload --port 8000   # serve the HTTP API locally
```

Python is **4-space** indented (PEP 8 / Ruff), which the root
[`.editorconfig`](../../.editorconfig) carves out from the repo-wide 2-space rule.

## Layout

```
services/bandit/
├── Dockerfile                      # python:3.12-slim + uv; runs uvicorn src.api:app on :8000
├── src/
│   ├── api.py                      # FastAPI app + routes (/health, /ready, /v1/place, /predict, /update), bearer auth, request-id
│   ├── place.py                    # /v1/place orchestration (series ledger, heuristic + LinUCB, displacement, fallbacks)
│   ├── schemas_place.py            # /v1/place Pydantic wire models (mirror packages/shared/src/placement.ts)
│   ├── schemas.py                  # Pydantic request/response models + ArmId / ARM_IDS
│   ├── serialization.py            # numpy glue + 422 guards (hydrate, all_finite, require_422)
│   ├── main.py                     # replay-evaluation demo
│   ├── core/                       # pure numpy port of backend/src/scheduler/core (see below)
│   ├── models/
│   │   └── linucb.py               # disjoint LinUCB + stateless score()/update() helpers
│   └── evaluators/
│       ├── event.py                # one logged interaction (x, arm, payoff)
│       ├── policy.py               # Policy ABC + RandomPolicy, LinUCBPolicy
│       └── policy_evaluator.py     # unbiased replay evaluation (Alg. 3)
└── tests/                          # pytest suite mirroring src/ (test_api.py routes, test_schemas.py models)
```

### Scheduler core port (`src/core/`, issue #60)

Pure numpy port of `backend/src/scheduler/core/*` (the TS core is the source of truth):
`slot`, `arms`, `context_vector`, `reward`, `series_spread`, `preference` (cell/move
reinforcement + `decay_matrix`) and `slot_score` (`best_free_slot`, vectorized). No I/O, no
clock, no randomness; instants are epoch-ms ints and `now`-style values are parameters.
Also ported: `adaptive_weights`, `linucb_best_slot` (slot-first scoring, issue #62 A: every
feasible 15-min start across all days scored `wL*armTerm + wP*pref/hours + stability`, ties by
`TIE_BREAK_ARM_ORDER` then earlier start), `displacement` (`plan_displacement`,
`pick_min_conflict_slot`, `pick_late_slot`) and `sync_conflicts`. The 7x24 matrix is 168 floats.

The scan is vectorized: per-slot local (weekday, hour) cells come from cached per-tz UTC
offset chunks (DST and fractional offsets such as Asia/Kolkata handled), window scores are
one prefix-sum over 15-min pieces, occupancy is a difference-array mask, and ties use
`argmax` on scores rounded to 1e-9 (earliest start wins, like the TS loop).

Parity: `tests/test_golden_ts.py` runs every case of the TS-exported
`backend/test/golden/scheduler-core.golden.json` (regenerate with
`pnpm --filter backend golden:export`; the TS core is the source of truth).
`tests/test_core_parity.py` keeps a few hand-checked fixtures (`tests/fixtures/golden/`) for
slot/calendar, preference reinforcement, decay, series spread and context-vector coverage the
export lacks. `tests/test_core_scan.py` checks the vectorized scans (heuristic and LinUCB)
against scalar transcriptions (UTC, Kolkata, both DST transitions).

Benchmark (`python -m scripts.bench_slot_scan`; 1000 placements, 60-day window = 5760
slots, 40 occupied intervals each, Europe/Paris, seeded; 16-thread Intel CPU, Python 3.12,
single process, warm tz cache):

| implementation | total | per placement |
| -------------- | ----- | ------------- |
| vectorized `best_free_slot` | 0.17-0.51 s (run to run) | 0.17-0.51 ms |
| scalar TS-style loop (extrapolated from 20) | ~38-111 s | ~38-111 ms |

About 200x speedup on the same run. (The simulator, metrics, alpha sweep and multiprocessing/cache from #60
are out of scope for this change.)

Container: `docker compose -f backend/compose.dev.yml up bandit` — published on the host at
`http://localhost:8100` (`BANDIT_SERVICE_URL` for backend dev, which runs on the host).

### Offline evaluation — `PolicyEvaluator`

Implements the unbiased replay estimator (Li et al., 2010, Algorithm 3): given a log
produced by a **uniformly random** logging policy, an event is _retained_ when the policy
under evaluation agrees with the logged arm (it scores and learns from it) and _discarded_
otherwise. `EvaluationResult` reports `n_matched` alongside the average payoff and flags
`exhausted` when the log ran out before the requested trial count. Use it to sweep `α` and
confirm the shipped default stays stable (does not select `EARLY_MORNING` as best on flat
data).

## Backend integration points

`BanditPlacer` (`scheduler/io/bandit-placer.service.ts`) builds the per-day context and
calls `/predict` via `BanditService` (`backend/src/bandit/`, timeout + heuristic fallback);
`ExperimentService` (`backend/src/experiments/`) is the 50/50 randomizer that writes
`SlotProposal`. `SchedulingFeedbackService` (first `MOVE`) and `RetainedSessionsService`
(`RETAINED`) compute the reward, call `/update`, and persist the returned `(A, b)` on
`BanditArmState`. Shared types live in `@zenflow/shared` (`SchedulingArm`, predict/update
request+response).

## Contributing

Follow the repo-wide **[CONTRIBUTING.md](../../CONTRIBUTING.md)**:
[Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/) with the `ml`
scope (e.g. `feat(ml): add LinUCB predict endpoint`). Run `uv run ruff format .`,
`uv run ruff check .`, `uv run mypy`, and `uv run pytest` before finishing.
