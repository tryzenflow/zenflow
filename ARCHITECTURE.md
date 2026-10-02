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
  over REST and SSE.
- The API is thin: it owns Postgres and the two Redis instances directly.
- All placement ranking is delegated to the Bandit service — a separate, stateless Python process.
- Ingestion pulls from the university's Portal, DKHP and Moodle systems; native push goes out
  to FCM/APNs.
- Production also runs an edge proxy and an observability stack, not drawn here.

## Scheduler components

![Zenflow scheduler component diagram](docs/architecture/scheduler-components.svg)

- The scheduler places exactly one task, or one series, per call and never touches anything else.
- The API side gathers day loads and bandit state, calls the Bandit service, and persists the
  result.
- A frozen heuristic is used only as a fallback when the Bandit service is unavailable.
- The Bandit service is the only ranking implementation. Its scoring logic is grouped into a
  scoring cluster (context vector, time-of-day arms, LinUCB slot search) and a supporting logic
  cluster (preference matrix, displacement, series spreading, conflict detection, reward
  calculation), reached through a placement endpoint and a feedback endpoint.
- A separate delayed-reward loop feeds move and retained events back to the feedback endpoint;
  a daily job decays the preference matrix independently of placement.

## Ingestion components

![Zenflow ingestion component diagram](docs/architecture/ingestion-components.svg)

- One rolling ticker claims due sync targets and dispatches them to the watchers.
- DKHP discovery reads each student's registration history once per semester. It must succeed
  before the timetable watcher fetches anything.
- The timetable and LMS watchers use the shared cache and fanout; the exam watcher is a plain
  fetch with neither.
- The portal client covers both the portal and DKHP; the LMS client covers Moodle. Responses go
  to pure parsers.
- Every parsed change is written through the materializer, the single path that touches a
  calendar session, with a confirm gate guarding against one-off upstream blips.
- Cached and fanned-out changes use the same path, so a hand-moved or deleted session is never
  silently overwritten.
