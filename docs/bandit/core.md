# Bandit core and model reference

For developers changing `services/bandit/src/core/*`, the LinUCB model or the offline tooling. Entry point: [`services/bandit/README.md`](../../services/bandit/README.md). The maths is in [ADR-0001](../adr/0001-linucb-model-design.md); placement ownership in [ADR-0003](../adr/0003-python-authoritative-placement.md).

## Model

- **Disjoint LinUCB**: 6 arms, one ridge regression each, scored `θ̂ᵀx + α·√(xᵀA⁻¹x)`.
  - `A = λI + Σ xxᵀ`, `b = Σ r·x`; `λ = 1.0`, `α = 0.15` (`BANDIT_RIDGE`, `BANDIT_ALPHA` in `backend/src/scheduler/constants.ts`, sent per request).
  - `A⁻¹` is cached per arm and invalidated on update.
  - `LinUCB` is arm-agnostic: arms are created lazily by string key at the ridge prior.
- **Arms** (`SchedulingArm` in `@zenflow/shared`), half-open, lower-inclusive: `EARLY_MORNING [00:00,06:00)`, `MORNING [06:00,11:00)`, `MIDDAY [11:00,14:00)`, `AFTERNOON [14:00,17:00)`, `EVENING [17:00,20:00)`, `NIGHT [20:00,24:00)`.
- **Cold arm** = ridge prior. It scores `α·√(xᵀx/λ)`, not `0`.
- **Warm-start prior (#60)**: a new arm is seeded from the default preference matrix.
  - Each of the 7x24 cells is one pseudo-observation for its band (typical-day context, cell value as reward).
  - Scaled so each arm holds `LINUCB_PRIOR_N0 = 5.0` pseudo-observations (`src/core/constants.py`); `0` restores `(λI, 0)`.
  - Evidence: [heuristic-vs-linucb-report.md](../scheduler/heuristic-vs-linucb-report.md).

## Context vector (`d = 7`, `src/core/context_vector.py`)

One vector per candidate day, shared by all 6 arms. The arm is never part of the vector, and the preference matrix is never an input.

| # | Feature | Encoding |
| - | --- | --- |
| 0 | remaining days until deadline | `clamp(x / MAX_SCAN_DAYS, 0, 1) * 2 - 1` |
| 1 | duration (minutes) | `clamp(x / DURATION_DIVISOR, 0, 1) * 2 - 1` |
| 2 | candidate days from now | `clamp(x / MAX_SCAN_DAYS, 0, 1) * 2 - 1` |
| 3 | candidate day is a weekend (ISO 6/7) | `+1` / `-1` |
| 4 | fixed-load hours (`LECTURE`+`EXAM`+`DND`) | `clamp(h / WORKLOAD_HOURS_DIVISOR, 0, 1)` |
| 5 | flexible-load hours (`TASK`+`ASSIGNMENT`) | `clamp(h / WORKLOAD_HOURS_DIVISOR, 0, 1)` |
| 6 | bias | `1` |

Constants: `MAX_SCAN_DAYS = 60`, `DURATION_DIVISOR = 480`, `WORKLOAD_HOURS_DIVISOR = 12`.

- Fixed divisors keep the vector stateless and reproducible; `is_weekend` is signed so `‖x‖` does not favour weekends.
- Excluded on purpose: per-weekday one-hots (collinear with the bias), extra per-type workload, tags, session type, semester phase.
- `d` fixes the width of `BanditArmState.A`/`.b` and `SlotProposal.featureVector` (`FEATURE_DIM` in `@zenflow/shared`). Changing it means resetting arm state and bumping `BANDIT_MODEL_VERSION`.

## Scheduler core (`src/core/`)

- Pure numpy: `slot`, `arms`, `context_vector`, `reward`, `series_spread`, `preference`, `slot_score`, `linucb_best_slot`, `displacement`, `sync_conflicts`, `prior`, `constants`.
- No I/O, clock or randomness; instants are epoch-ms ints. The 7x24 matrix is 168 floats.
- Python is the sole ranking implementation. `linucb_best_slot`, `context_vector`, `arms` and `displacement` have no TS counterpart.
- A ranking change goes in `src/core/*` with pytest coverage and updated `packages/shared/contract/place/*.json` fixtures, never a TS port.

### `linucb_best_slot`

- Scores every feasible 15-min start on all days as `armTerm + wS * stability`. No preference-matrix term.
- `wS = stability_weight(prevStart, now)`: `1.0` while the old start is <= 24h away, fading linearly to `0.05` at 7 days (`STABILITY_*` in `constants.py`).
- Exact ties (within 1e-9) break in order:
  1. seeded band order per request (`seeded_tie_break_order`, `EARLY_MORNING` last);
  2. distance from the band's centre;
  3. the earlier start.
- The scan is vectorized: per-tz UTC offset chunks (DST, fractional offsets like Asia/Kolkata), a prefix-sum for window scores, a difference-array occupancy mask, and `argmax` on scores rounded to 1e-9.

### Golden parity (ADR-0003 phase 6)

`backend/src/scheduler/core/*` keeps only the frozen TS fallback (`slot-score.ts`, `preference.ts`, `series-spread.ts`, `sync-conflicts.ts`), used by `FallbackPlacer` when `/v1/place` is unreachable.

- `tests/test_golden_ts.py` runs `backend/test/golden/scheduler-core.golden.json` (`slotPreferenceScore`, `stabilityScore`, `bestFreeSlot`, `findConflictingTaskIds`). Regenerate with `pnpm --filter backend golden:export`.
- `tests/test_core_parity.py`: hand-checked fixtures in `tests/fixtures/golden/`.
- `tests/test_core_scan.py`: vectorized vs scalar scans (UTC, Kolkata, both DST transitions).

### Slot-scan benchmark

`uv run python -m scripts.bench_slot_scan`: 1000 placements, 60-day window (5760 slots), 40 occupied intervals, Europe/Paris, seeded, warm tz cache.

| Implementation | Total | Per placement |
| --- | --- | --- |
| vectorized `best_free_slot` | 0.17-0.51 s | 0.17-0.51 ms |
| scalar TS-style loop (extrapolated from 20) | ~38-111 s | ~38-111 ms |

## Offline tooling

- `uv run python -m src.main`: replay-evaluation demo, LinUCB vs random baseline.
- `PolicyEvaluator` (`src/evaluators/`): unbiased replay estimator (Li et al., 2010, Algorithm 3).
  - Needs a log from a uniformly random policy; an event is retained when the evaluated policy agrees with the logged arm.
  - `EvaluationResult` reports `n_matched`, the average payoff, and `exhausted` when the log ran out.
  - Use it to sweep `α` and confirm the default does not pick `EARLY_MORNING` on flat data.
- `uv run pytest tests/test_learning.py -s`: prints simulated learning curves.
- `src/simulation/`: seeded synthetic-student simulator, heuristic vs LinUCB. It validates mechanics, not real-world superiority.
  - `uv run python -m src.simulation.run` with `--seed`, `--students`, `--events`, `--workers`, `--alpha-sweep`, `--alphas`, `--scenarios`, `--no-cache`.
  - Scripts in `scripts/`: `bench_simulation.py`, `bench_warmstart.py`, `run_seeds.py`.
