# Zenflow Bandit Service

A small Python service hosting the **Disjoint LinUCB** model that personalizes Zenflow's
task scheduling. Linear algebra is a poor fit for the NestJS/TypeScript backend, so the
model lives here and the API calls it over internal HTTP (`BANDIT_SERVICE_URL`).

Design: [`docs/adr/0001-linucb-model-design.md`](../../docs/adr/0001-linucb-model-design.md).
Arm → timestamp mapping: [`docs/scheduler/reranking.md`](../../docs/scheduler/reranking.md).
Experiment: [`docs/scheduler/ab-testing.md`](../../docs/scheduler/ab-testing.md).

> **Status: wired end to end.** Routes (`src/api.py`): `GET /health`, `GET /ready`,
> `POST /v1/place` (all placement, both A/B policies), `POST /v1/update` (delayed reward).

## Design

- **Disjoint LinUCB.** Each of the 6 time-of-day arms keeps its own ridge regression
  `A = λI + Σ xxᵀ`, `b = Σ r·x` over a context vector shared across arms, scored by
  `θ̂ᵀx + α·√(xᵀA⁻¹x)`. `λ = 1.0`, `α = 0.15` (ADR-0001 §10). `A⁻¹` is cached per arm and
  invalidated on update. The `LinUCB` class is arm-agnostic — arms are created lazily by
  string key at the ridge prior — so the same code serves 3 arms (the offline demo) or 5
  (production).
- **Canonical arms** (`SchedulingArm` in `@zenflow/shared`), half-open, lower-inclusive:
  `EARLY_MORNING [00:00,06:00)`, `MORNING [06:00,11:00)`, `MIDDAY [11:00,14:00)`,
  `AFTERNOON [14:00,17:00)`,
  `EVENING [17:00,20:00)`, `NIGHT [20:00,24:00)`.
- **Context vector, `d = 7`:**
  - deadline days, duration, days from now;
  - `is_weekend` (±1);
  - fixed-load hours and flexible-load hours;
  - bias.

  Details: ADR-0001 §5.1.
- **Cold arm** = ridge prior. It scores `α·√(xᵀx/λ)`, not `0`.
- **Learning check:** `uv run pytest tests/test_learning.py -s` prints simulated learning curves.
- **Stateless service.** This service holds **no per-user state**. The NestJS backend owns
  `(A, b)` persistence (Postgres table `BanditArmState`, ADR-0001 §6.1) and passes the 5
  arms' `(A, b)` in every request; `/v1/update` returns the new `(A, b)` for the backend to
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
| `POST /v1/update`  | Body: `ridge`, `arm`, `x`, `reward`, `state` (that arm's `(A, b)`, `[]` = cold). Returns the new `{A, b}` (`A` is `d*d` row-major). |

### `POST /v1/place` (ADR-0003, phase 2; Nest calls it from phase 3)

One request = one placement event (a single `TASK`, or one materialized series). Arm scores are
computed in-process from the supplied `(A, b)`.

- Contract: `packages/shared/src/placement.ts`, mirrored by `src/schemas_place.py`
  (`extra="forbid"`, camelCase, epoch-ms ints, `contractVersion: 1`). Examples:
  `packages/shared/contract/place/*.json`.
- **Scan window** (`src/place.py`): local days `[start, deadline]`, capped by `maxScanDays`. For a
  series, the member's window from `series_day_windows` (`min(floor((deadline - next15)/1d), 59)` days).
  Days already holding `MAX_SERIES_PER_DAY` (1) siblings are skipped; siblings' intervals are hard blocks.
- **Policies**: HEURISTIC = best preference slot per day, best score across days (earlier day wins
  ties). LINUCB = slot-first scan over all days scoring arm term + proximity-scaled stability. LINUCB falls back to the
  heuristic (`appliedPolicy: "HEURISTIC"`) on no bandit state, a singular matrix or no surviving slot.
- **Series batching**: every member's LinUCB context vectors + arm scores are built once per request
  as a single `(M, N, D)` tensor (`M` = member count, always — `M=1` for a lone task; `N` = the max
  candidate-day count across members, padded with a validity mask; `D` = `FEATURE_DIM`, 7) —
  `_Placer._build_batch` in `src/place.py`. Arm scoring flattens to `(M*N, D)` and calls
  `LinucbPolicy.arm_scores_batch` once per arm (6 calls total, each inverting that arm's `A` once
  regardless of member/day count), instead of the old per-`duration_minutes` dict cache that rebuilt
  vectors from scratch per distinct duration. The per-member slot pick (`best_linucb_slot`, day/DST
  scan, sibling threading for `MAX_SERIES_PER_DAY`) is unchanged — only cheap array indexing into the
  precomputed tensor per member, not a 4th (slot) tensor axis.
- **Response**: `heuristic` / `linucb` appear only if requested (primary or `computeBoth`; heuristic
  also on fallback). `startMs` is the applied pick. `mode: "PREFLIGHT"` runs the heuristic only.
- **No free slot (single member)**:
  1. First call returns `NEEDS_INFEASIBLE_CONTEXT`.
  2. Second call (with `infeasible`) tries EDF displacement over the deadline day (widening to +/-1
     day) -> `DISPLACED` with `moves`. The new task takes the earliest start (clear of fixed blocks)
     whose cascade succeeds; colliding flexible tasks are settled in deadline order, each moving to
     the free start nearest its old one -- on **any day** up to its own deadline (within
     `horizonOccupied`), never onto a fixed block or an equal-deadline peer (no ripple shifts).
  3. Otherwise the user's policy: `ACCEPT_CONFLICTS` -> `ACCEPTED_CONFLICTS` (min-overlap start;
     `conflicting` is true only if it really overlaps `horizonOccupied`), `ACCEPT_LATE_DEADLINE` ->
     `ACCEPTED_LATE` (`late: true`), else the last resort below.
  4. A series member with no slot is never displaced; siblings are still placed.
  5. **Never unplaced.** In `PLACE` mode the row already exists, so every remaining miss becomes
     `ACCEPTED_LAST_RESORT` (`late` / `conflicting` describe the pick): the least-conflict start
     before the deadline, else (single task) the first free start up to 30 days late, else
     `last_resort_pin` — the latest on-grid start ending by the deadline, or the next slot once
     that has passed, pushed past siblings. A series whose deadline has passed is pinned
     back-to-back. `PREFLIGHT` still answers `INFEASIBLE`, so Nest can reject before writing.
- **Errors**: `422` validation (FastAPI `detail` list); `422 {"code":"CONTRACT_VERSION","supported":1,"got":n}`;
  `413` body > 2 MB; `401` bad or missing bearer token.
- **Auth**: set `BANDIT_SERVICE_TOKEN` to require `Authorization: Bearer <token>` on `/v1/place`,
  `/v1/update`. `BANDIT_SERVICE_TOKEN_PREVIOUS` is also accepted for rotation. Unset = open
  (dev/tests). `/health` and `/ready` are exempt.
- **Observability**: each response has `x-request-id` (echoes the inbound header, else `req-<n>`).
  `paramsVersion` = `py-` + sha256 of the core constants and contract version; Nest stores it as
  `SlotProposal.modelVersion`. `timingsMs = {decode, context, predict, scan, displace, total}`.
- **Deterministic**: no randomness, no clock (`nowMs` is a field); same body, same picks.

**Latency** (`uv run python -m scripts.bench_place`): Windows dev box, single process, `TestClient`
round trip (no network). One 90 min task, 30-day scan, Europe/Paris, 6-14 occupied blocks/day, 200
runs. ADR target: p99 < 400 ms.

| Case                               | Payload | Round trip p50 / p95 / p99 | Handler p50 / p95 | Scan p50 / p95 |
| ---------------------------------- | ------- | -------------------------- | ----------------- | -------------- |
| HEURISTIC primary                  | 70 KB   | 7.0 / 14.3 / 29.3 ms       | 4.6 / 11.8 ms     | 1.9 / 2.2 ms   |
| LINUCB primary (warm state)        | 70 KB   | 8.6 / 16.7 / 19.4 ms       | 5.9 / 14.0 ms     | 2.8 / 3.1 ms   |
| computeBoth (LINUCB primary)       | 70 KB   | 10.7 / 16.6 / 29.9 ms      | 7.9 / 14.1 ms     | 4.6 / 5.0 ms   |
| computeBoth, dense (14 blocks/day) | 83 KB   | 12.1 / 19.3 / 37.0 ms      | 8.7 / 15.2 ms     | 4.9 / 5.7 ms   |

Tests: `tests/test_place.py` (behaviour, auth, errors), `tests/test_place_contract.py` (every
fixture plus golden TS `bestFreeSlot`), and `tests/test_place_batch.py` (output-equivalence between
`_build_batch`'s batched `(M, N, D)` tensor path and a reconstructed pre-batch sequential oracle, across
`M=1`, disjoint/dense series windows, all-cold arms, and a DST-boundary candidate day).
`scripts/gen_place_fixtures.py` regenerates the Python-owned fixtures; review the diff like a golden
update.

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
│   ├── api.py                      # FastAPI app + routes (/health, /ready, /v1/place, /v1/update), bearer auth, request-id
│   ├── place.py                    # /v1/place orchestration (series ledger, batched (M,N,D) context/arm-score tensor, displacement, fallbacks)
│   ├── policies/                   # one class per /v1/place placement policy
│   │   ├── heuristic.py            # HeuristicPolicy: best per-day preference slot
│   │   ├── linucb.py               # LinucbPolicy: slot-first scan wired to models/linucb.py
│   │   └── selector.py             # PolicySelector: HEURISTIC vs LINUCB A/B split
│   ├── schemas_place.py            # /v1/place Pydantic wire models (mirror packages/shared/src/placement.ts)
│   ├── schemas.py                  # Pydantic request/response models + ArmId / ARM_IDS
│   ├── serialization.py            # numpy glue + 422 guards (hydrate, hydrate_arms, all_finite, require_422)
│   ├── main.py                     # replay-evaluation demo
│   ├── core/                       # pure numpy port of backend/src/scheduler/core (see below)
│   ├── models/
│   │   ├── schemas.py              # ArmParams: mutable per-arm ridge-regression state
│   │   └── linucb.py               # stateful LinUCB bandit (evaluators) + stateless score()/update()
│   └── evaluators/
│       ├── event.py                # one logged interaction (x, arm, payoff)
│       ├── policy.py               # Policy ABC + RandomPolicy, LinUCBPolicy
│       └── policy_evaluator.py     # unbiased replay evaluation (Alg. 3)
└── tests/                          # pytest suite mirroring src/ (test_api.py routes, test_schemas.py models)
```

### Scheduler core (`src/core/`, authoritative since ADR-0003)

Pure numpy: `slot`, `arms`, `context_vector`, `reward`, `series_spread`, `preference`
(+ `decay_matrix`), `slot_score` (`best_free_slot`, `stability_weight`), `linucb_best_slot`,
`displacement` and `sync_conflicts`. No I/O, clock or randomness; instants are epoch-ms ints.
The 7x24 matrix is 168 floats.

Originally ported from `backend/src/scheduler/core/*` (issue #60, when the TS core was the
source of truth). **ADR-0003 phase 6 reversed that**: Python is now the sole ranking
implementation — `linucb_best_slot`, `context_vector`, `arms` and
`displacement` no longer have a TS counterpart at all (that code was deleted from `backend/`).
A behaviour change to any of those goes in this package's `src/core/*` with pytest coverage
and updated `packages/shared/contract/place/*.json` fixtures — not a TS port, per the rewritten
CLAUDE.md invariant 2.

- `linucb_best_slot` (issue #62 A): scores every feasible 15-min start on all days as
  `armTerm + wS*stability` -- no preference-matrix term. `wS = stability_weight(prevStart, now)` is
  1.0 while the task's old start is <=24h away and fades linearly to 0.05 at 7 days, so upcoming
  tasks stay put and distant ones follow LinUCB. Exact ties are broken in this order:
  1. a seeded band order per request (`seeded_tie_break_order`, with EARLY_MORNING last);
  2. distance from the band's centre;
  3. the earlier start.

  LinUCB never reads the preference matrix.
- The scan is vectorized: per-tz UTC offset chunks (DST and fractional offsets like Asia/Kolkata),
  a prefix-sum for window scores, a difference-array occupancy mask, and `argmax` on scores rounded to
  1e-9 (earliest start wins, like the original TS loop this was ported from).

**Golden parity, narrowed (ADR-0003 phase 6):** `backend/src/scheduler/core/*` now only keeps
the **frozen TS fallback** (`slot-score.ts`, `preference.ts`, `series-spread.ts`,
`sync-conflicts.ts` — used solely by `FallbackPlacer` when `/v1/place` is unreachable), so the
golden fixtures only cover that narrow surface, not LinUCB/arms/displacement (those are
Python-only now, verified by this package's own tests, not a TS golden file):

- `tests/test_golden_ts.py` runs every case of the narrowed
  `backend/test/golden/scheduler-core.golden.json` (`slotPreferenceScore`, `stabilityScore`,
  `bestFreeSlot`, `findConflictingTaskIds`) against `slot_score`/`sync_conflicts`
  (regenerate the JSON: `pnpm --filter backend golden:export`). A fix to the frozen TS
  fallback must keep this green; it is otherwise not expected to change.
- `tests/test_core_parity.py` has hand-checked fixtures (`tests/fixtures/golden/`) the export lacks.
- `tests/test_core_scan.py` checks the vectorized scans against scalar versions (UTC, Kolkata, both
  DST transitions).

Benchmark (`python -m scripts.bench_slot_scan`): 1000 placements, 60-day window (5760 slots), 40
occupied intervals, Europe/Paris, seeded, single process, warm tz cache.

| implementation | total | per placement |
| -------------- | ----- | ------------- |
| vectorized `best_free_slot` | 0.17-0.51 s | 0.17-0.51 ms |
| scalar TS-style loop (extrapolated from 20) | ~38-111 s | ~38-111 ms |

About 200x faster. The simulator, metrics, alpha sweep and multiprocessing/cache from #60 are out of scope.

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

- `PythonPlacer` → `PlacementClient` (`backend/src/scheduler/io/`) calls `/v1/place` with each
  arm's `(A, b)`. `ExperimentService` assigns the 50/50 policy and writes `SlotProposal`.
- `SchedulingFeedbackService` (first `MOVE`) and `RetainedSessionsService` (`RETAINED`) call
  `/v1/update` via `BanditService` and persist the new `(A, b)` in `BanditArmState`.
- Wire types: `@zenflow/shared` (`placement.ts`, `bandit.ts`).

## Contributing

Follow the repo-wide **[CONTRIBUTING.md](../../CONTRIBUTING.md)**:
[Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/) with the `ml`
scope (e.g. `feat(ml): add a LinUCB feature`). Run `uv run ruff format .`,
`uv run ruff check .`, `uv run mypy`, and `uv run pytest` before finishing.
