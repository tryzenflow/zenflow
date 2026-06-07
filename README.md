# Zenflow

> A deadline-driven calendar that schedules your work for you — then learns how you
> actually work and personalizes itself over time.

You tell Zenflow **what** needs doing (title, estimated duration, earliest start,
deadline, tags) and Zenflow decides **when**: an Earliest-Deadline-First (EDF) engine
drops each task into the first open 15-minute slot inside your working hours. When you
drag or resize a task to fix the machine's guess, every edit is recorded as a
`TaskEvent`. That audit trail is the fuel for the personalization roadmap — heuristics
today, contextual bandits and collaborative cold-start later (see
[`docs/heuristic.md`](docs/heuristic.md)).

**Status:** Phase 1 (deterministic EDF) is shipped. Phases 2–4 are planned.

---

## Repository layout

This is a **pnpm workspace monorepo** (pnpm `10.32.1`).

| Path | What it is | Docs |
|------|------------|------|
| [`frontend/`](frontend/) | React 19 + Vite PWA — the calendar UI | [frontend/README.md](frontend/README.md) |
| [`backend/`](backend/) | NestJS API — auth, tasks, files, and the EDF scheduler | [backend/README.md](backend/README.md) |
| [`packages/shared/`](packages/shared/) | `@zenflow/shared` — the TS types shared by FE + BE (the API contract) | — |
| [`services/bandit/`](services/bandit/) | Placeholder FastAPI ML service for Phases 3–4 | [services/bandit/README.md](services/bandit/README.md) |
| [`docs/`](docs/) | Design docs — currently the scheduling/ML roadmap | [docs/heuristic.md](docs/heuristic.md) |
| [`CLAUDE.md`](CLAUDE.md) | Operating guide + conventions for Claude Code and contributors | [CLAUDE.md](CLAUDE.md) |

## Tech stack at a glance

| Layer | Choices |
|-------|---------|
| Frontend | React 19, Vite 6, Tailwind v4 (OKLch tokens), Radix UI, Zustand, React Router 7, React Hook Form + Zod, dnd-kit, TipTap, date-fns-tz, rrule, Playwright |
| Backend | NestJS 11, Prisma 6 + PostgreSQL, Redis (sessions + cache), Passport (OTP), rrule + luxon + date-fns, class-validator, Swagger, Jest |
| Shared | TypeScript types (`@zenflow/shared`), built to CommonJS |
| ML (future) | Python + FastAPI (LinUCB → LightFM); not yet implemented |
| Infra | Docker Compose (api, postgres, redis, mail, scheduler, Caddy) |

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

| Phase | Mechanism | Status |
|-------|-----------|--------|
| **1** | Pure EDF sorting (deterministic) | **Shipped** — `backend/src/scheduler` |
| **2** | Modified EDF + per-tag bias + 7×48 penalty matrix | Planned |
| **3** | Contextual bandits (LinUCB) in a FastAPI service | Planned — `services/bandit` |
| **4** | Bandits + collaborative filtering / archetype cold-start | Planned |

Full details and the data model behind each phase: [`docs/heuristic.md`](docs/heuristic.md).

## Working in this repo with Claude Code

This repo ships a Claude Code **feature pipeline** under [`.claude/`](.claude/). Run the whole
thing with `/feature "<request>"`, or any phase on its own:

| Phase | Skill | Subagent(s) | Output |
|-------|-------|-------------|--------|
| Requirements | `/req-analysis` | `product-manager` (GitHub MCP) | a GitHub issue |
| Design | `/ui-ux` | `ui-ux-designer` (Figma MCP) | Figma frames + component spec |
| Architecture | `/arch` | `solution-architect` | committed ADR + diagrams in `docs/adr/` |
| Implementation | `/implement` | `backend-engineer` + `frontend-engineer` (+ `ml-engineer`), parallel | code + tests + commits |
| Review | `/verify-changes` | `code-reviewer` (opus, Playwright MCP) | live-verified Markdown report |
| QA | `/qa` | `backend-qa-engineer` + `frontend-qa-engineer`, parallel | HTTP/e2e tests in a Docker test env |

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

Full setup, style, commit, branching, and testing guidelines: **[CONTRIBUTING.md](CONTRIBUTING.md)**.
