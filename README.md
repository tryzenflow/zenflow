# Zenflow

A deadline-driven calendar that schedules your work for you, then learns how you work.

Tell Zenflow **what** needs doing (a study task with a duration and deadline, or a fixed lecture, exam, assignment or do-not-disturb block). It decides **when**: each task goes into the best free 15-minute slot before its deadline. Drag or resize a placed task and Zenflow learns from it.

## Features
- Automatic placement of tasks before their deadlines; fixed sessions stay where you put them.
- Task series and recurring sessions, with "this one / this and following" edits.
- Personalised scheduling: a time-of-day preference heuristic and a per-student LinUCB bandit, run as a live A/B experiment.
- Moodle LMS and university portal sync: deadlines, timetable and exams land on the calendar.
- Notes with file attachments, reminders, and an in-app and push notification inbox.
- Web (PWA) and mobile (iOS, Android) clients.

## Quick start

Prerequisites: Node 20+, pnpm 10.32.1, Docker, and the [`gh` CLI](https://cli.github.com) (authenticated) for issue and PR work.

```bash
pnpm install && pnpm shared:build

cd backend
docker compose -f compose.dev.yml up -d   # Postgres, Redis, mail catcher
pnpm prisma:dev:migrate
pnpm start:dev                            # API http://localhost:8000, Swagger /api

cd ../frontend && pnpm dev                # http://localhost:5173
```

Env: see each app's `.env.example`. Details: [backend/README.md](backend/README.md).

## Repository

| Path | What | Docs |
| --- | --- | --- |
| `frontend/` | React 19 + Vite PWA | [README](frontend/README.md) |
| `mobile/` | Expo + React Native app | [README](mobile/README.md) |
| `backend/` | NestJS API, scheduler, ingestion | [README](backend/README.md) |
| `services/bandit/` | FastAPI placement and LinUCB service | [README](services/bandit/README.md) |
| `packages/shared/` | `@zenflow/shared` API contract types | |
| `packages/core/` | `@zenflow/core` logic shared by both clients | |
| `mockups/` | Static HTML mobile screens | [index](mockups/index.html) |
| `loadtest/` | k6 load tests | [README](loadtest/README.md) |
| `docs/` | ADRs, backend reference, scheduler design, ops, benchmarks | [adr](docs/adr/), [backend](docs/backend/), [scheduler](docs/scheduler/), [ops](docs/ops/) |

Architecture: [ARCHITECTURE.md](ARCHITECTURE.md). Decisions: [docs/adr/](docs/adr/).

## Working here
- Conventions, invariants and the agent setup: [AGENTS.md](AGENTS.md).
- Commits, branches, PRs, labels: [CONTRIBUTING.md](CONTRIBUTING.md).
- Bugs and features: [issue templates](https://github.com/tryzenflow/zenflow/issues/new/choose).

## License
[PolyForm Strict 1.0.0](LICENSE): the source is visible for study and noncommercial use. No commercial use, redistribution or derived works.
