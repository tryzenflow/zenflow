# Zenflow Bandit Service (placeholder)

Planned FastAPI microservice that will host the **Phase 3** contextual bandit (LinUCB)
and **Phase 4** collaborative-archetype cold-start seeding for Zenflow's scheduler.
The authoritative roadmap lives in [`docs/heuristic.md`](../../docs/heuristic.md).

> **Status: not implemented.** Phase 1 ships the deterministic EDF engine inside the
> NestJS API ([`backend/src/scheduler`](../../backend/src/scheduler)). This directory
> reserves the path and documents the intended surface; there is no runnable code yet.

> **Scope note (Phase 2 ≠ here).** The Phase-2 heuristics (signed-matrix re-ranker,
> per-tag duration corrector, matrix decay) and the simulation/evaluation harness live
> in the **NestJS backend**, not this service — they are pure TypeScript that re-ranks
> EDF's feasible set, so they belong next to the scheduler core
> ([`backend/src/scheduler/reranker.ts`](../../backend/src/scheduler/reranker.ts),
> `duration-bias.ts`, `matrix-decay.ts`) and the harness in
> [`backend/src/simulation`](../../backend/src/simulation) (`pnpm sim:run | sim:eval |
> sim:recovery | sim:significance`). This Python service is reserved for **Phase 3+**
> (LinUCB) where a linear model genuinely needs a non-TS runtime. See
> [`docs/phase-2-evaluation-steps.md`](../../docs/phase-2-evaluation-steps.md).

---

## Why a separate service

Linear bandit and matrix-factorization models are a poor fit for the NestJS/TypeScript
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

## Planned HTTP surface

| Route | Purpose |
|-------|---------|
| `POST /predict` | recommended slot (LinUCB arm) for a task's feature vector |
| `POST /update`  | apply the reward signal (1.0 accepted / 0.0 moved / 0.5 resized) |
| `POST /seed`    | cold-start a new user from an archetype's weight matrix |

## Planned layout

```
services/bandit/
├── app/
│   ├── main.py            # FastAPI app
│   ├── routers/           # predict.py, update.py, seed.py
│   ├── models/            # linucb.py, archetype.py
│   └── schemas.py         # Pydantic request/response models
├── requirements.txt
└── Dockerfile
```

## Integration checklist (when implementation begins)

1. Implement `scoreSlot()` in the NestJS scheduler to call `POST /predict` with the
   context vector and fall back to pure EDF on timeout/error.
2. Wire `BANDIT_SERVICE_URL` through backend config (it is already reserved alongside the
   `scheduler` service in `backend/compose.*.yml`).
3. Feed `TaskEvent`s to `POST /update` so weights track real overrides.
4. Reference [`docs/heuristic.md`](../../docs/heuristic.md) as the source of truth for the
   phased rollout and the Phase-2 heuristics that precede the bandit.

## Contributing

This service is a placeholder — no code yet. When implementation begins, follow the repo-wide
**[CONTRIBUTING.md](../../CONTRIBUTING.md)**: **2-space** indentation
([`.editorconfig`](../../.editorconfig)) and
[Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/) with the `ml`
scope (e.g. `feat(ml): add LinUCB predict endpoint`). Python code should be formatted with a
standard formatter (Black/Ruff) once the toolchain is set up.
