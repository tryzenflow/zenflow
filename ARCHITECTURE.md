# Zenflow Architecture

Diagram-first companion to [README.md](README.md), for contributors placing a change before reading the detail.

- Conventions and invariants: [AGENTS.md](AGENTS.md)
- Per-app detail: [backend](backend/README.md), [frontend](frontend/README.md), [bandit service](services/bandit/README.md)
- Backend reference: [docs/backend/](docs/backend/)
- Sequence flows: [docs/architecture/scheduler-flows.md](docs/architecture/scheduler-flows.md)
- Decisions behind this shape: [docs/adr/](docs/adr/)

## System / container view

![Zenflow C4 container diagram](docs/architecture/c4-container.svg)

- Students use the Web PWA or the mobile app; both call one NestJS API over REST and SSE.
- The API is thin: it owns Postgres and the two Redis instances directly.
- All placement ranking is delegated to the Bandit service, a separate stateless Python process.
- Ingestion pulls from the university's Portal, DKHP and Moodle systems.
- Native push goes out to FCM/APNs.
- Production also runs an edge proxy and an observability stack, not drawn here.

## Scheduler components

![Zenflow scheduler component diagram](docs/architecture/scheduler-components.svg)

- The scheduler places exactly one task, or one series, per call and touches nothing else.
- The API side gathers day loads and bandit state, calls the Bandit service and persists the result.
- A frozen heuristic is used only as a fallback when the Bandit service is unavailable.
- The Bandit service is the only ranking implementation, reached through a placement endpoint and a feedback endpoint.
- Scoring cluster: context vector, time-of-day arms, LinUCB slot search.
- Supporting cluster: preference matrix, displacement, series spreading, conflict detection, reward calculation.
- A delayed-reward loop feeds move and retained events back to the feedback endpoint.
- A daily job decays the preference matrix independently of placement.

## Ingestion components

![Zenflow ingestion component diagram](docs/architecture/ingestion-components.svg)

- One rolling ticker claims due sync targets and dispatches them to the watchers.
- DKHP discovery reads each student's registration history once per semester.
- It must succeed before the timetable watcher fetches anything.
- The timetable and LMS watchers use the shared cache and fanout; the exam watcher is a plain fetch with neither.
- The portal client covers the portal and DKHP; the LMS client covers Moodle. Responses go to pure parsers.
- Every parsed change is written through the materializer, the single path that touches a calendar session.
- A confirm gate in the materializer guards against one-off upstream blips.
- Cached and fanned-out changes use the same path, so a hand-moved or deleted session is never silently overwritten.
