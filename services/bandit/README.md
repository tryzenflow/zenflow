# Zenflow Bandit Service

Python service hosting the **Phase 3** contextual bandit (LinUCB) and, later, the
**Phase 4** collaborative-archetype cold-start seeding for Zenflow's scheduler.
The authoritative roadmap lives in [`docs/heuristic.md`](../../docs/heuristic.md).

> **Status: model core + offline evaluation harness implemented; HTTP surface not yet.**
> `LinUCB`, the `Policy` abstraction, and the replay evaluator are in place and tested.
> The FastAPI routes below are still to come, so the NestJS API does not call this
> service yet — Phase 1's deterministic EDF engine
> ([`backend/src/scheduler`](../../backend/src/scheduler)) remains the live scheduler.

> **Scope note (Phase 2 ≠ here).** The Phase-2 heuristics (signed-matrix re-ranker,
> matrix decay) and the simulation/evaluation harness live in the **NestJS backend**,
> not this service — they are pure TypeScript that re-ranks EDF's feasible set, so they
> belong next to the scheduler core
> ([`backend/src/scheduler/reranker.ts`](../../backend/src/scheduler/reranker.ts),
> `matrix-decay.ts`) and the harness in
> [`backend/src/simulation`](../../backend/src/simulation) (`pnpm sim:run | sim:eval |
sim:recovery | sim:significance`). This Python service is reserved for **Phase 3+**
> (LinUCB) where a linear model genuinely needs a non-TS runtime. See
> [`docs/phase-2-evaluation-steps.md`](../../docs/phase-2-evaluation-steps.md).
>
> **Note (2026-08-20):** Phase 2's per-tag duration-bias corrector (`duration-bias.ts`,
> the `DurationAdjustmentMode` preference, `GET /users/me/tag-bias`) has been removed
> entirely — it is not a Phase-2-lives-elsewhere omission from this README, it no longer
> exists anywhere. See
> [`docs/heuristic.md`](../../docs/heuristic.md#removed-per-tag-duration-bias-correction)
> and [ADR-0001](../../docs/adr/0001-phase-2-scheduling-heuristic-and-transparency-ui.md)
> for why. Tags remain a live signal for Phase 3+ via multi-hot encoding in the bandit's
> context vector (see below) — this removal does not touch that.

---

## Why a separate service

Linear bandit is a poor fit for the NestJS/TypeScript
backend. The plan is a small Python service the API calls over internal HTTP
(`BANDIT_SERVICE_URL`) only at task-creation time. The EDF engine already exposes the
`feasibleSlots()` + `SlotReRanker` seam in
[`backend/src/scheduler/edf.ts`](../../backend/src/scheduler/edf.ts) and
[`reranker.ts`](../../backend/src/scheduler/reranker.ts) (wrapped by `SchedulerService`)
where bandit scoring will plug in as a re-ranker over the feasible set — Phase 1 ships the
identity re-ranker, so pure EDF order wins until then.

The data the model will consume already accumulates in Phase 1:

- **`TaskEvent`** (`CREATE`/`MOVE`/`RESIZE`/`KEEP`/`COMPLETE`/`ABANDON`) with
  `oldSnapshot`/`newSnapshot` (each carrying the task's tag names at event time, and the
  EDF-`suggestedStartTime` on MOVE/RESIZE) and a `rewardScore` field — the reward signal.
- **`User.preferenceMatrix`** — a flat **672**-int **signed** matrix (7 days × 96
  fifteen-minute slots, slot-grid-aligned). Manual moves decrement the vacated cell (−1) and
  increment the destination (+1); a KEEP/complete-in-slot increments the kept cell (+1).
- **`User.roleArchetypeId`** — reserved for Phase-4 cold-start cluster assignment.

## Toolchain

Managed with [uv](https://docs.astral.sh/uv/) (Python 3.12). Unlike the rest of the
monorepo, this service is **not** a pnpm workspace — run its commands from
`services/bandit/`.

```powershell
uv sync                      # create .venv and install deps (incl. dev group)
uv run pytest                # unit tests
uv run ruff check .          # lint
uv run ruff format .         # format
uv run mypy                  # typecheck (strict)
uv run python -m src.main    # replay-evaluation demo: LinUCB vs. random baseline
```

Python is **4-space** indented (PEP 8 / Ruff), which the root
[`.editorconfig`](../../.editorconfig) carves out from the repo-wide 2-space rule.

## Layout

```
services/bandit/
├── src/
│   ├── main.py                      # demo entry point (FastAPI app to come)
│   ├── models/
│   │   └── linucb.py                # disjoint LinUCB (Li et al., 2010, Alg. 1)
│   └── evaluators/
│       ├── event.py                 # one logged interaction (x, arm, payoff)
│       ├── policy.py                # Policy ABC + RandomPolicy, LinUCBPolicy
│       └── policy_evaluator.py      # unbiased replay evaluation (Alg. 3)
└── tests/                           # pytest suite mirroring src/
```

### The model — `LinUCB`

Disjoint LinUCB: each arm keeps its own ridge regression `A = λI + Σ xxᵀ`, `b = Σ r·x`
over a context vector shared across arms, and is scored by
`θ̂ᵀx + α·√(xᵀA⁻¹x)`. Arms are created lazily at the ridge prior, so `update()` is safe
for an arm the model never selected — the normal case in replay, where the logged arm
came from a different policy. `A⁻¹` is cached per arm and invalidated on update.

The model is a reproducible function of `(inputs + seed)`: the only randomness is
uniform tie-breaking, drawn from an **injected** `random.Random`. This mirrors the
scheduler-core invariant in [`CLAUDE.md`](../../CLAUDE.md) — no `Math.random()`, no
clock reads, no module-global RNG.

### Offline evaluation — `PolicyEvaluator`

Implements the unbiased replay estimator (Li et al., 2010, Algorithm 3): given a log
produced by a **uniformly random** logging policy, an event is _retained_ when the
policy under evaluation agrees with the logged arm (it scores and learns from it) and
_discarded_ otherwise. `EvaluationResult` reports `n_matched` alongside the average
payoff, and flags `exhausted` when the log ran out before the requested trial count —
so an estimate resting on fewer samples than intended is visible rather than silent.

## Planned HTTP surface

| Route           | Purpose                                                          |
| --------------- | ---------------------------------------------------------------- |
| `POST /predict` | recommended slot (LinUCB arm) for a task's feature vector        |
| `POST /update`  | apply the reward signal (1.0 accepted / 0.0 moved / 0.5 resized) |
| `POST /seed`    | cold-start a new user from an archetype's weight matrix          |

## Phase 3 — Contextual Bandits (LinUCB)

Replace rigid heuristics with a policy that balances exploring new schedule distributions
against exploiting known habits, updating in real time.

- **Feature vectorization (context):** tags are flattened into a fixed-width **multi-hot
  encoded vector** over the global tag pool (e.g. two of six tags → `[1,0,1,0,0,0]`). The
  full context vector is assembled as:

  `[day_of_week, hours_to_deadline, t₁, t₂, …, tₙ, current_day_load]`

- **The loop:**
  1. NestJS flattens the multi-tag context and POSTs the vector to the bandit service.
  2. The service scores the available time slots (arms) and returns the highest-reward slot.
  3. The user accepts it (high reward) or drags it elsewhere (negative reward), updating the
     model weights in real time.

## Phase 4 — Collaborative Archetypes & Cold Start

Eliminate the new-user data void using aggregate behavior across the whole user base.

- **Matrix factorization** (e.g. LightFM / collaborative filtering) over a **tag
  co-occurrence matrix** to learn how users cluster cross-functional work.
- **User archetypes** from multi-tag signatures (e.g. `#dev`+`#ops` → "Night Owl
  Developer"; `#marketing`+`#copy` → "Creative Lead").
- **Cold start:** map a new user's onboarding role to an archetype and seed their
  multi-hot bandit weights + preference matrix from that cluster's baseline averages
  (`User.roleArchetypeId`).

## Integration checklist (remaining)

1. Wrap `LinUCB` in the FastAPI routes above (`src/main.py` is currently a demo entry point).
2. Add model persistence — state is in-process today, so it does not survive a restart.
3. Implement `scoreSlot()` in the NestJS scheduler to call `POST /predict` with the
   context vector and fall back to pure EDF on timeout/error.
4. Wire `BANDIT_SERVICE_URL` through backend config (it is already reserved alongside the
   `scheduler` service in `backend/compose.*.yml`).
5. Feed `TaskEvent`s to `POST /update` so weights track real overrides.
6. Reference [`docs/heuristic.md`](../../docs/heuristic.md) as the source of truth for the
   phased rollout and the Phase-2 heuristics that precede the bandit.

## Contributing

Follow the repo-wide **[CONTRIBUTING.md](../../CONTRIBUTING.md)**:
[Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/) with the `ml`
scope (e.g. `feat(ml): add LinUCB predict endpoint`). Run `uv run ruff format .`,
`uv run ruff check .`, `uv run mypy`, and `uv run pytest` before finishing.
