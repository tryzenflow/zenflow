# Zenflow Bandit Service (placeholder)

FastAPI microservice that will host the **Phase 3** contextual bandit (LinUCB)
and **Phase 4** collaborative-archetype cold-start seeding. See
`docs/heuristic-progression.md` and `docs/system-design.md`.

> **Status: not implemented.** Phase 1 ships the deterministic EDF engine inside
> the NestJS API (`backend/src/scheduler`). This directory reserves the path and
> documents the intended surface; there is no runnable code yet.

## Planned surface (Phase 3+)

| Route | Purpose |
|-------|---------|
| `POST /predict` | Return the recommended slot (LinUCB arm) for a task's feature vector |
| `POST /update`  | Apply the reward signal (1.0 accepted / 0.0 moved / 0.5 resized) |
| `POST /seed`    | Cold-start a new user from an archetype's weight matrix |

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

## Integration

The NestJS API will call this service over internal HTTP (`BANDIT_SERVICE_URL`)
only on task creation. The EDF engine exposes a `scoreSlot()` seam
(`backend/src/scheduler/edf.ts`) where bandit/penalty scoring will plug in.
