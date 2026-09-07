# Zenflow

> A deadline-driven calendar that schedules your work for you — then learns how you
> actually work and personalizes itself over time.

You tell Zenflow **what** needs doing (a study `TASK` with a duration and a deadline, or a
fixed `LECTURE` / `EXAM` / `ASSIGNMENT` / `DND` block) and Zenflow decides **when**: the
scheduler places each new `TASK` into its single best free 15-minute slot before the
deadline, scored by a per-user time-of-day preference. Fixed sessions stay where you put
them. When you drag or resize a placed task, that edit is recorded as a `SessionEvent`
(move-or-keep) — the fuel for the personalization roadmap: a preference heuristic today,
a per-student contextual bandit (LinUCB) running as a live A/B experiment, collaborative
cold-start later. See [`docs/scheduler/heuristic.md`](docs/scheduler/heuristic.md) and
[`docs/adr/`](docs/adr/).

Students can also connect their university's **Moodle LMS** and **student portal** so
assignment deadlines, the class timetable and exam schedule land on the calendar
automatically, with an in-app notification inbox.

**Status:** the preference heuristic (Policy A) and the LinUCB A/B path (Policy B) are both
shipped; the personalization writers past that are planned.

---

## Repository layout

This is a **pnpm workspace monorepo** (pnpm `10.32.1`).

| Path                                   | What it is                                                              | Docs                                                    |
| -------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------ |
| [`frontend/`](frontend/)               | React 19 + Vite PWA — the desktop calendar client                     | [frontend/README.md](frontend/README.md)               |
| [`mobile/`](mobile/)                   | Expo + React Native app (iOS / Android / web)                         | [mobile/README.md](mobile/README.md)                   |
| [`backend/`](backend/)                 | NestJS API — auth, sessions, files, DLU ingestion, the scheduler      | [backend/README.md](backend/README.md)                 |
| [`packages/shared/`](packages/shared/) | `@zenflow/shared` — the TS types shared by FE + mobile + BE (contract) | —                                                      |
| [`packages/core/`](packages/core/)     | `@zenflow/core` — calendar-block / overlap / form-schema logic shared by both clients | —                                     |
| [`services/bandit/`](services/bandit/) | FastAPI service hosting the Disjoint LinUCB model                     | [services/bandit/README.md](services/bandit/README.md) |
| [`docs/`](docs/)                       | ADRs + the scheduling/ML design docs                                 | [docs/adr/](docs/adr/), [docs/scheduler/](docs/scheduler/) |
| [`CLAUDE.md`](CLAUDE.md)               | Operating guide + conventions for Claude Code and contributors        | [CLAUDE.md](CLAUDE.md)                                 |

## Tech stack at a glance

| Layer    | Choices                                                                                                                                               |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend | React 19, Vite 6, Tailwind v4 (OKLch tokens), Radix UI, Zustand, React Router 7, React Hook Form + Zod, dnd-kit, TipTap, date-fns-tz, rrule, Playwright |
| Mobile   | Expo SDK 52, React Native 0.76, Expo Router, NativeWind, `@gorhom/bottom-sheet`, Reanimated, tentap editor                                              |
| Backend  | NestJS 11, Prisma 6 + PostgreSQL, Redis (sessions + cache), Passport (OTP), rrule + luxon + date-fns, class-validator, Swagger, Jest                    |
| Shared   | `@zenflow/shared` (contract types) + `@zenflow/core` (client logic), built to CommonJS                                                                 |
| ML       | Python + FastAPI hosting Disjoint LinUCB; called over internal HTTP (`BANDIT_SERVICE_URL`), heuristic fallback when absent                              |
| Infra    | Docker Compose (api, postgres, redis ×2, mail, bandit, Caddy)                                                                                          |

## Quick start

Prerequisites: **Node 20+**, **pnpm 10.32.1**, and **Docker** (for the backend stack).

```bash
# 1. Install all workspace deps from the repo root
pnpm install

# 2. Build the shared types first — FE and BE both import @zenflow/shared
pnpm shared:build

# 3. Start the backend stack (API + Postgres + Redis + mail) via Docker
cd backend
sh build_images.sh                 # build the api/scheduler images
#   create .env.prod and docker.env (see backend/README.md)
docker compose up -d               # uses compose.local.yml
#   API      → http://localhost:5000
#   Swagger  → http://localhost:5000/api
#   MailHog  → catches the OTP login emails (see compose file for the port)

# 4. Start the frontend dev server
cd ../frontend
pnpm dev                           # → http://localhost:5173
```

For backend-only iteration without Docker, see [backend/README.md](backend/README.md)
(Prisma migrate/studio, env files, `pnpm --filter backend start:dev`).

## Workspace commands (run from repo root)

```bash
pnpm install            # install everything
pnpm shared:build       # build @zenflow/shared (run before typechecking FE/BE)
pnpm -r build           # build every package
pnpm -r typecheck       # typecheck every package
pnpm -r test            # run every package's tests
```

Per-app scripts live in each app's `package.json` — see the app READMEs.

## The scheduling roadmap

Zenflow's intelligence is staged. Each phase reuses the prior phase's data.

| Phase | Mechanism                                                                 | Status                                              |
| ----- | ----------------------------------------------------------------------- | -------------------------------------------------- |
| **1** | Preference heuristic — score each free slot by a per-user 7×24 time-of-day matrix (Policy A) | **Shipped** — `backend/src/scheduler` |
| **2** | Nightly decay + move-or-keep learning writer for that matrix           | Partial — decay cron shipped; learning writer planned |
| **3** | Per-student Disjoint LinUCB (Policy B), 50/50 A/B against Policy A       | **Shipped** — `services/bandit` + `scheduler/io`   |
| **4** | Collaborative filtering / archetype cold-start                          | Planned                                            |

Design docs: [`docs/scheduler/heuristic.md`](docs/scheduler/heuristic.md),
[`docs/adr/0001-linucb-model-design.md`](docs/adr/0001-linucb-model-design.md),
[`docs/adr/0002-scheduling-simplification.md`](docs/adr/0002-scheduling-simplification.md).

## Working in this repo with Claude Code

This repo ships a Claude Code **feature pipeline** under [`.claude/`](.claude/). Run the whole
thing with `/feature "<request>"`, or any phase on its own:

| Phase          | Skill             | Subagent(s)                                                          | Output                                  |
| -------------- | ----------------- | -------------------------------------------------------------------- | --------------------------------------- |
| Requirements   | `/req-analysis`   | `product-manager` (GitHub MCP)                                       | a GitHub issue                          |
| Design         | `/ui-ux`          | `ui-ux-designer` (Figma MCP)                                         | Figma frames + component spec           |
| Architecture   | `/arch`           | `solution-architect`                                                 | committed ADR + diagrams in `docs/adr/` |
| Implementation | `/implement`      | `backend-engineer` + `frontend-engineer` (+ `ml-engineer`), parallel | code + tests + commits                  |
| Review         | `/verify-changes` | `code-reviewer` (opus, Playwright MCP)                               | live-verified Markdown report           |
| QA             | `/qa`             | `backend-qa-engineer` + `frontend-qa-engineer`, parallel             | HTTP/e2e tests in a Docker test env     |

- **Subagents** (`.claude/agents/`) — the engineers above plus the pipeline roles.
- **Skills** (`.claude/skills/`) — `feature` (orchestrator) + the six phase skills.
- **Hooks** (`.claude/settings.json` → `.claude/hooks/*.mjs`, Node.js) — per-edit format
  (+ `prisma generate`); on stop (after all edits) `eslint --fix` (incl. relative→`@/` alias
  rewriting) then `pnpm -r typecheck`.
- **MCP** (`.mcp.json`) — `github`, `figma`, `playwright` servers; set
  `GITHUB_PERSONAL_ACCESS_TOKEN` and `FIGMA_API_KEY` before using the requirements/design phases.

See [CLAUDE.md](CLAUDE.md) for conventions and the critical invariants.

## Contributing

- **Formatter / linter:** ESLint (the backend also runs Prettier through it), **2-space
  indentation** enforced by [`.editorconfig`](.editorconfig). Frontend imports use the `@/…`
  alias (autofixed). Run `pnpm --filter <app> lint` and `pnpm -r typecheck` before pushing.
- **Commits:** follow [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/)
  — `type(scope): summary` (e.g. `feat(calendar): …`, `fix(frontend): …`, `docs: …`).
- **Pull requests:** branch off `master` (`type/short-description`), give the PR a Conventional
  Commit title, and fill in every section of the
  [PR template](.github/PULL_REQUEST_TEMPLATE.md) — what & why, linked issue, area(s) touched,
  and how to test. Make sure lint, typecheck, and the relevant tests are green first.

Full setup, style, commit, branching, and PR guidelines: **[CONTRIBUTING.md](CONTRIBUTING.md)**.
