# Zenflow Architecture

This is a diagram-first companion to [README.md](README.md) — it shows the shape of the system so
a new contributor can place a change before reading the detail, without duplicating any app's
prose.

- Conventions and invariants: [AGENTS.md](AGENTS.md)
- Per-app detail: the backend, frontend and bandit-service READMEs
- The decisions behind this shape: [docs/adr/](docs/adr/)

## System / container view

![Zenflow C4 container diagram](docs/architecture/c4-container.svg)

- A student reaches Zenflow through the Web PWA or the mobile app, both talking to one NestJS API
  over REST + SSE.
- The API is thin: it owns Postgres and the two Redis instances directly.
- All placement ranking is delegated to the Bandit service — a separate, stateless Python process.
- Ingestion pulls from the university's Portal and Moodle systems; native push goes out to
  FCM/APNs.
- Production adds a Caddy edge proxy and an OTel/Tempo/Loki/Prometheus/Grafana observability
  stack; both are out of scope for this container-level view and not drawn.

## Scheduler components

![Zenflow scheduler component diagram](docs/architecture/scheduler-components.svg)

- The scheduler places exactly one `TASK` (or one series) per call and never touches anything
  else.
- `backend/src/scheduler/io/*` gathers day loads and bandit state, calls the Bandit service's
  `POST /v1/place`, and persists the result.
- `backend/src/scheduler/core/*` is pure calendar/preference-write logic plus a frozen TS
  heuristic, used only as `FallbackPlacer` when the breaker is open or Python is down.
- The Bandit service (Python, authoritative) is the only ranking implementation. Its
  `src/core/*` modules are grouped into a **scoring** cluster (`context_vector.py`, `arms.py`,
  `linucb_best_slot.py`, `slot_score.py`) and a **supporting/shared** cluster (`preference.py`,
  `displacement.py`, `series_spread.py`, `sync_conflicts.py`, `reward.py`, `slot.py`,
  `constants.py`), reached through the two endpoints `POST /v1/place` and `POST /update`.
- A separate delayed-reward loop feeds `MOVE`/`RETAINED` events back to `POST /update`; a daily
  cron decays the preference matrix independently of placement.

## Ingestion components

![Zenflow ingestion component diagram](docs/architecture/ingestion-components.svg)

- One rolling ticker (`IngestionTickerService`, a 1-minute heartbeat) claims due
  `(integration, kind)` targets and dispatches to four watchers.
- Watchers fetch through `PortalAPIService`/`LMSService` after decrypting stored credentials, then
  hand the response to pure parsers.
- Every parsed item writes through `MaterializerService` — the single path that ever touches a
  `Session` row, with a confirm-gate and two-miss rule guarding against one-off upstream blips.
- The cross-student occurrence cache and its fan-out both feed the same `materialize()` call
  rather than writing in bulk.
- So a hand-moved or deleted session is never silently overwritten, regardless of which student's
  walk (or a classmate's) discovered the change.
