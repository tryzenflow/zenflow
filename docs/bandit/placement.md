# Bandit `/v1/place` reference

For developers changing or calling `POST /v1/place` and `POST /v1/update`. Entry point: [`services/bandit/README.md`](../../services/bandit/README.md). Decision record: [ADR-0003](../adr/0003-python-authoritative-placement.md).

One request = one placement event: a single `TASK` or one materialized series. Arm scores are computed in-process from the supplied `(A, b)`.

## Contract

- Types: `packages/shared/src/placement.ts`, mirrored by `services/bandit/src/schemas_place.py`.
- Wire rules: `extra="forbid"`, camelCase, epoch-ms ints, `contractVersion: 1`.
- Fixtures: `packages/shared/contract/place/*.json` (see its README).
- Deterministic: no randomness, no clock (`nowMs` is a field); same body gives the same picks.

## `POST /v1/update`

- Body: `ridge`, `arm`, `x`, `reward`, `state` (that arm's `(A, b)`; `[]` = cold). Returns the new `{A, b}`; `A` is `d*d` row-major.
- `d` is inferred from `len(x)` and validated: all `x` equal; each non-empty `A` is `d*d`; each non-empty `b` is `d`.
- HTTP 422 on bad shapes, non-finite values, `alpha < 0`, `ridge <= 0` or an unknown `arm`.
- Reward ([ADR-0001](../adr/0001-linucb-model-design.md)):

| Event | Reward |
| --- | --- |
| `RETAINED` | `+1` |
| `MOVE` | `-clamp(abs(dragDistanceMinutes) / 240, 0, 1)` |
| resize-only `MOVE` (`dragDistanceMinutes == 0`) | `0` |
| `CREATE` | never sent |

## Scan window (`src/place.py`)

- Local days from the next 15-min boundary to the deadline, capped by `maxScanDays`.
- Series member: window from `series_day_windows`, span `min(floor((deadline - next15) / 1 day), 59)` days.
- Days already holding `MAX_SERIES_PER_DAY` (1) siblings are skipped; siblings' intervals are hard blocks.

## Policies

- **HEURISTIC**: best preference slot per day, best score across days; the earlier day wins ties.
- **LINUCB**: slot-first scan over all days, scoring arm term plus proximity-scaled stability (see [core.md](./core.md)).
- LINUCB falls back to the heuristic (`appliedPolicy: "HEURISTIC"`) on no bandit state, a singular matrix or no surviving slot.
- `mode: "PREFLIGHT"` runs the heuristic only.
- Response: `heuristic` / `linucb` appear only if requested (primary or `computeBoth`; heuristic also on fallback). `startMs` is the applied pick.

## Series batching

- Each request builds all members' context vectors and arm scores once, as an `(M, N, D)` tensor (`_Placer._build_batch`).
  - `M` = member count (1 for a lone task), `N` = max candidate-day count (padded with a validity mask), `D` = `FEATURE_DIM` (7).
- Scoring flattens to `(M*N, D)` and calls `LinucbPolicy.arm_scores_batch` once per arm: 6 calls, one `A` inversion each.
- The per-member slot pick (`best_linucb_slot`, DST scan, sibling threading) indexes the precomputed tensor.

## Pairwise-sampled series (#58): two complete plans

- Trigger: `members.length > 1`, every member `computeBoth: true`, one shared `primaryPolicy`. Nest rolls both once per series.
- `_Placer.run` builds two whole-series plans over the same batch via `_run_plan(policy)`: all-heuristic and all-LinUCB.
  - Each plan has its own sibling ledger (non-overlap and `MAX_SERIES_PER_DAY`) and its own last resort.
  - Per member, LinUCB falls back to the heuristic when it finds no slot.
- Per member: `heuristic` and `linucb` are its picks in each plan (`null` where that plan fell back or went last resort).
- `startMs`, `outcome`, `appliedPolicy`, `late`, `conflicting` come from the primary plan, so applied starts are unchanged.
- The alternative may overlap an applied sibling; Nest filters those before surfacing it.
- Everything else keeps the single shared-ledger pass: lone task, `PREFLIGHT`, partial `computeBoth`, no usable bandit state, or a mixed `primaryPolicy` (not a 422, so rollout is safe).
- No wire-shape change. Tests: `tests/test_place_series_pairwise.py`; fixtures `series-pairwise-{heuristic,linucb}-primary.json`.

## No free slot (single member)

1. First call returns `NEEDS_INFEASIBLE_CONTEXT`.
2. Second call (with `infeasible`) tries EDF displacement over the deadline day, widening to +/-1 day, giving `DISPLACED` with `moves`.
   - The new task takes the earliest start, clear of fixed blocks, whose cascade succeeds.
   - Colliding flexible tasks settle in deadline order. Each moves to the free start nearest its old one, on any day up to its own deadline (within `horizonOccupied`).
   - Never onto a fixed block or an equal-deadline peer (no ripple shifts).
3. Otherwise the user's policy applies:
   - `ACCEPT_CONFLICTS` gives `ACCEPTED_CONFLICTS` (min-overlap start; `conflicting` only if it really overlaps `horizonOccupied`).
   - `ACCEPT_LATE_DEADLINE` gives `ACCEPTED_LATE` (`late: true`).
   - Else the last resort below.
4. A series member with no slot is never displaced; siblings are still placed.
5. **Never unplaced.** In `PLACE` mode every remaining miss becomes `ACCEPTED_LAST_RESORT` (`late` / `conflicting` describe the pick):
   - least-conflict start before the deadline; else (single task) the first free start up to 30 days late;
   - else `last_resort_pin`: the latest on-grid start ending by the deadline, or the next slot once that has passed, pushed past siblings;
   - a series whose deadline has passed is pinned back-to-back.
   - `PREFLIGHT` still answers `INFEASIBLE`, so Nest can reject before writing.

## Errors, auth, observability

| Item | Behaviour |
| --- | --- |
| Validation | `422` (FastAPI `detail` list) |
| Contract version | `422 {"code":"CONTRACT_VERSION","supported":1,"got":n}` |
| Body size | `413` above 2 MB |
| Bad or missing bearer | `401` |
| Auth | `BANDIT_SERVICE_TOKEN` set requires `Authorization: Bearer <token>` on `/v1/place`, `/v1/update`; unset = open (dev/tests) |
| Rotation | `BANDIT_SERVICE_TOKEN_PREVIOUS` is also accepted |
| Exempt | `/health`, `/ready` |
| `x-request-id` | Echoes the inbound header, else `req-<n>` |
| `paramsVersion` | `py-` + sha256 of core constants and contract version; Nest stores it as `SlotProposal.modelVersion` |
| `timingsMs` | `{decode, context, predict, scan, displace, total}` |

## Latency

`uv run python -m scripts.bench_place`: Windows dev box, single process, `TestClient` round trip (no network). One 90 min task, 30-day scan, Europe/Paris, 6-14 occupied blocks/day, 200 runs. ADR target: p99 < 400 ms.

| Case | Payload | Round trip p50 / p95 / p99 | Handler p50 / p95 | Scan p50 / p95 |
| --- | --- | --- | --- | --- |
| HEURISTIC primary | 70 KB | 7.0 / 14.3 / 29.3 ms | 4.6 / 11.8 ms | 1.9 / 2.2 ms |
| LINUCB primary (warm state) | 70 KB | 8.6 / 16.7 / 19.4 ms | 5.9 / 14.0 ms | 2.8 / 3.1 ms |
| computeBoth (LINUCB primary) | 70 KB | 10.7 / 16.6 / 29.9 ms | 7.9 / 14.1 ms | 4.6 / 5.0 ms |
| computeBoth, dense (14 blocks/day) | 83 KB | 12.1 / 19.3 / 37.0 ms | 8.7 / 15.2 ms | 4.9 / 5.7 ms |

## Tests

- `tests/test_place.py`: behaviour, auth, errors.
- `tests/test_place_contract.py`: every fixture plus golden TS `bestFreeSlot`.
- `tests/test_place_batch.py`: batched `(M, N, D)` path equals a sequential oracle (`M=1`, disjoint/dense windows, cold arms, a DST-boundary day).
- `scripts/gen_place_fixtures.py` regenerates the Python-owned fixtures; review the diff like a golden update.
