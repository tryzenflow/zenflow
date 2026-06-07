# CLAUDE.md

Operating guide for working in the Zenflow monorepo. Read [README.md](README.md) for the
product overview; this file is the conventions + "how to not break things" reference.

## Repository map & ownership

| Area | Path | Owner subagent | Reference |
|------|------|----------------|-----------|
| Frontend (React PWA) | `frontend/` | `frontend-engineer` | [frontend/README.md](frontend/README.md) |
| Backend (NestJS API + EDF) | `backend/` | `backend-engineer` | [backend/README.md](backend/README.md) |
| Shared types (FE/BE contract) | `packages/shared/` | `backend-engineer` | — |
| ML / scheduling future | `services/bandit/`, telemetry | `ml-engineer` | [services/bandit/README.md](services/bandit/README.md), [docs/heuristic.md](docs/heuristic.md) |

Delegate area work to the matching subagent in `.claude/agents/`.

## Toolchain

- **Package manager: pnpm `10.32.1`** (a workspace). Never use `npm` or `yarn`.
- **Node 20+.** Host dev shell here is **Windows PowerShell** — prefer PowerShell syntax
  in commands you ask the user to run.

```bash
pnpm install            # install all workspaces
pnpm shared:build       # build @zenflow/shared — run BEFORE typechecking FE/BE
pnpm -r build | typecheck | test     # run a script across all packages
pnpm --filter backend <script>       # target one app (also: frontend)
```

Per-app scripts: backend `start:dev | typecheck | lint | test | test:e2e | prisma:dev:*`;
frontend `dev | build | typecheck | lint | test:e2e`.

## Critical invariants

1. **`@zenflow/shared` is the API contract.** Request/response types (`CreateTaskInput`,
   `TasksListResponse`, `RescheduleResponse`, `ApiSuccess`/`ApiError`, …) live in
   `packages/shared/src`. Change them there, then `pnpm shared:build` so both FE and BE see
   the new types. Don't duplicate these shapes in either app.

2. **The scheduler core is pure.** `backend/src/scheduler/edf.ts` (and `slot.ts`,
   `horizon.ts`) take `now` as a parameter and do no I/O or randomness. Only
   `scheduler.service.ts` touches Prisma / writes telemetry. Keep that split. Any change to
   a pure function must update its `*.spec.ts` in the same change.

3. **Durations are always positive multiples of 15** (minutes). Slots are 15-minute;
   `DAILY_HORIZON` = 1440. Don't introduce off-grid times.

4. **Recurrence is materialized, not virtual.** A recurring task is expanded into one real
   `Task` row per occurrence, all sharing a `seriesId`. Each row schedules independently and
   is safe to mutate alone; bulk edits use `scope: "one" | "following"`.

5. **Timezone wall-clock rule (frontend).** All calendar `Date`s carry the user-tz wall
   clock in their local fields — go through `frontend/src/utils/tz.ts`, never a bare
   `new Date()` in day/grid logic. Convert back with `zonedWallClockToUtc` before calling
   the API.

6. **API response envelope.** Backend controllers return
   `{ success: true, message, data }`; errors are `{ success: false, message, … }`. Let
   NestJS `HttpException`s propagate.

7. **Auth is OTP + Redis sessions** (no passwords/JWT). Protected routes use
   `CookieAuthGuard`; the current user comes from `@CurrentUser()`.

## Conventions (digest — full versions in the app READMEs)

- **Backend:** plural feature modules/classes; `*Dto` validated by `class-validator` under
  a strict global pipe (`whitelist` + `forbidNonWhitelisted` + `transform`); custom
  decorators `@CurrentUser`, `@IsValidTimezone`, `@IsRRule`; Prisma errors via
  `src/prisma/error-codes.ts`. Global prefix `/api/v1`; Swagger at `/api`.
- **Frontend:** kebab-case files, PascalCase components; axios only in `src/api/`; Zustand
  for the user store; build UI from `components/ui/` primitives; Tailwind v4 OKLch tokens
  ("Warm Sunrise" Taupe+Amber); **no mobile-responsive target**.

## Tests, lint, typecheck

- Backend unit tests are `*.spec.ts` (Jest) next to the code — pure functions like the
  scheduler are the priority to cover. E2e is `backend/test/jest-e2e.json` (needs the test
  DB). Frontend e2e is Playwright in `frontend/e2e/` (needs the backend stack + MailHog).
- Run `pnpm --filter <app> typecheck` and `lint` before finishing. After editing shared
  types, `pnpm shared:build` first.
- **Formatting:** ESLint (+ Prettier on the backend), 2-space indentation (`.editorconfig`);
  frontend uses the `@/…` import alias. **Commits** follow
  [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/)
  (`type(scope): summary`). Full guidelines: [CONTRIBUTING.md](CONTRIBUTING.md).

## Where things run

- API → `http://localhost:5000`; Swagger UI → `http://localhost:5000/api`.
- Frontend dev → `http://localhost:5173` (`VITE_API_URL` points at the API).
- OTP login emails are caught by MailHog in the local Docker stack.

## Keeping docs in sync

When a change affects schema, endpoints, the scheduler, screens, conventions, or the ML
roadmap, update the matching README (and `docs/heuristic.md` for scheduling/ML).

## Feature workflow (skills & subagents)

This repo ships a phased feature pipeline under `.claude/`. Run the whole thing with
**`/feature "<request>"`**, or any single phase on its own:

| Phase | Skill | Spawns | Output |
|-------|-------|--------|--------|
| Requirements | `/req-analysis` | `product-manager` (GitHub MCP) | a GitHub issue |
| Design | `/ui-ux` | `ui-ux-designer` (Figma MCP) | Figma frames + component spec |
| Architecture | `/arch` | `solution-architect` | committed ADR + diagrams in `docs/adr/` |
| Implementation | `/implement` | `backend-engineer` + `frontend-engineer` (+ `ml-engineer` if needed), parallel | code + tests + commits |
| Review | `/verify-changes` | `code-reviewer` (opus, Playwright MCP) | live-verified Markdown report |
| QA | `/qa` | `backend-qa-engineer` + `frontend-qa-engineer`, parallel | HTTP/e2e tests in a Docker test env |

MCP servers (`github`, `figma`, `playwright`) are declared in `.mcp.json` and need their
tokens (`GITHUB_PERSONAL_ACCESS_TOKEN`, `FIGMA_API_KEY`) set. Hooks (`.claude/settings.json`
→ `.claude/hooks/*.mjs`, Node.js): per-edit = format only (prettier for backend) +
`prisma generate`; the Stop hook runs once per turn **after all edits** — `eslint --fix`
(including rewriting deep relative imports to the `@/…` alias on the frontend) then
`pnpm -r typecheck`.
