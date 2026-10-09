# Zenflow Bandit Service

For developers. A small Python (FastAPI + numpy) service that owns all slot placement for Zenflow's scheduler.

- Hosts the Disjoint LinUCB model and the heuristic policy; the backend calls it over internal HTTP (`BANDIT_SERVICE_URL`).
- Authoritative for placement ([ADR-0003](../../docs/adr/0003-python-authoritative-placement.md)); fail-open: Nest falls back to the frozen TS heuristic on any error, timeout or empty pick.
- Stateless: the backend owns per-student `(A, b)` (`BanditArmState`) and sends all 6 arms' state with each request.
- Reproducible: no clock, no module-global RNG; tie-breaks use a seeded order.

## Run

Managed with [uv](https://docs.astral.sh/uv/) (Python 3.12). Not a pnpm workspace; run from `services/bandit/`.

```bash
uv sync                                           # create .venv, install deps (incl. dev)
uv run uvicorn src.api:app --reload --port 8000   # serve the API
uv run pytest                                     # tests
uv run ruff check . && uv run ruff format .       # lint, format
uv run mypy                                       # typecheck (strict)
uv run python -m src.main                         # offline demo: LinUCB vs random baseline
```

- Container: `docker compose -f backend/compose.dev.yml up bandit`, published at `http://localhost:8100` (set `BANDIT_SERVICE_URL` to it for host-run backend dev).
- Python is 4-space indented; the root [`.editorconfig`](../../.editorconfig) carves it out of the 2-space rule.
- Commits: [CONTRIBUTING.md](../../CONTRIBUTING.md), scope `ml`. Run format, lint, mypy and pytest before finishing.

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `BANDIT_SERVICE_TOKEN` | unset (open) | Require `Authorization: Bearer <token>` on `/v1/place`, `/v1/update` |
| `BANDIT_SERVICE_TOKEN_PREVIOUS` | unset | Also accepted, for rotation |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318` | OTLP/HTTP traces and metrics |
| `OTEL_SDK_DISABLED` | unset | `true` turns OpenTelemetry off |
| `OTEL_SERVICE_NAME` | `zenflow-bandit` | Service name |
| `LOG_LEVEL` | `INFO` | Log level |
| `SERVICE_VERSION` | `0.1.0` | `service.version` resource attribute |
| `ENV` | `development` | `deployment.environment.name` |

## API

| Route | Purpose |
| --- | --- |
| `GET /health` | Liveness: `{"status":"ok"}` |
| `GET /ready` | Readiness (numpy import, tz cache warm-up, self-test placement): `200 {"status":"ready"}` or `503`. Compose healthcheck target |
| `POST /v1/place` | Authoritative placement for both A/B policies |
| `POST /v1/update` | Delayed reward: returns the new `{A, b}` for one arm |

- Errors: `422` validation or `CONTRACT_VERSION`, `413` body over 2 MB, `401` bad token.
- Detail (scan window, series, displacement, last resort, latency): [docs/bandit/placement.md](../../docs/bandit/placement.md).

## Contract fixtures

- Wire types: `packages/shared/src/placement.ts` (mirrored by `src/schemas_place.py`) and `bandit.ts`.
- Fixtures: `packages/shared/contract/place/*.json`.
- A behaviour change is a Python change, plus pytest, plus updated fixtures. Never port ranking logic back to TS.
- `uv run python -m scripts.gen_place_fixtures` regenerates the Python-owned fixtures; review the diff like a golden update.
- `tests/test_golden_ts.py` ties the frozen TS fallback to the Python core; keep it green (`pnpm --filter backend golden:export` regenerates its JSON).

## Where the maths lives

- Model, rewards, hyperparameters (`λ = 1.0`, `α = 0.15`): [ADR-0001](../../docs/adr/0001-linucb-model-design.md).
- Context vector (`d = 7`), arms, tie-breaks, benchmarks: [docs/bandit/core.md](../../docs/bandit/core.md).
- Arm to timestamp mapping: [docs/scheduler/reranking.md](../../docs/scheduler/reranking.md).
- A/B experiment: [docs/scheduler/ab-testing.md](../../docs/scheduler/ab-testing.md); results: [heuristic-vs-linucb-report.md](../../docs/scheduler/heuristic-vs-linucb-report.md).

## Layout

```text
services/bandit/
├── Dockerfile            # python:3.12-slim + uv; uvicorn src.api:app on :8000
├── scripts/              # bench_place, bench_slot_scan, gen_place_fixtures, simulation benches
├── src/
│   ├── api.py            # FastAPI app, routes, bearer auth, request-id
│   ├── place.py          # /v1/place orchestration: series ledger, (M,N,D) batch, displacement, fallbacks
│   ├── schemas_place.py  # /v1/place wire models
│   ├── schemas.py        # /v1/update models, ArmId / ARM_IDS
│   ├── serialization.py  # numpy glue and 422 guards
│   ├── core/             # pure numpy scheduler core (slots, arms, context, scoring, displacement)
│   ├── policies/         # heuristic, linucb, selector (A/B split)
│   ├── models/           # ArmParams state, LinUCB score()/update()
│   ├── evaluators/       # replay evaluation (Li et al. 2010)
│   ├── simulation/       # seeded synthetic-student simulator
│   ├── otel.py           # OpenTelemetry and logging bootstrap
│   ├── telemetry.py      # tracer and metric instruments
│   └── main.py           # offline demo
└── tests/                # pytest suite mirroring src/
```

## Backend integration

- `PythonPlacer` via `PlacementClient` (`backend/src/scheduler/io/`) calls `/v1/place` with each arm's `(A, b)`.
- `ExperimentService` assigns the 50/50 policy and writes `SlotProposal`.
- `SchedulingFeedbackService` (first `MOVE`) and `RetainedSessionsService` (`RETAINED`) call `/v1/update` via `BanditService` and persist `(A, b)`.
