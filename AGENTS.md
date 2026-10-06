# AGENTS.md

Operating guide for working in the Zenflow monorepo. Read [README.md](README.md) for the
product overview; this file is the conventions + "how to not break things" reference.
See [ARCHITECTURE.md](ARCHITECTURE.md) for system/component diagrams.

## Repository map & ownership

Agents own domains, not tech layers. Exact globs live in `.agents/agents/*.md` (`owns`); `node .agents/scripts/owner.mjs <path>` says who owns a file.

| Agent | Domain | Read first |
| --- | --- | --- |
| `scheduler` | Placement, sessions, series, TS fallback, Python contract | [ADR-0003](docs/adr/0003-python-authoritative-placement.md), [backend/README.md](backend/README.md) |
| `bandit` | `services/bandit`, LinUCB, telemetry, A/B | [services/bandit/README.md](services/bandit/README.md), [ADR-0001](docs/adr/0001-linucb-model-design.md) |
| `campus-sync` | DLU/LMS ingestion, integrations | [backend/README.md](backend/README.md) |
| `calendar-web` | `frontend/`, `packages/core` | [frontend/README.md](frontend/README.md) |
| `calendar-mobile` | `mobile/`, `mockups/` | [mobile/README.md](mobile/README.md) |
| `accounts-api` | Auth, users, files, notifications, Prisma, `packages/shared` | [ADR-0004](docs/adr/0004-s3-file-storage.md) |
| `platform` | Compose, CI/CD, observability, secrets, load tests | [docs/ops/](docs/ops/) |
| `zenflow-qa` | API and UI e2e in the test stack | [CONTRIBUTING.md](CONTRIBUTING.md) |
| `zenflow-reviewer` | Read-only review against the invariants below | |

Delegate work in a domain to its agent; cross-domain changes go to each owner in turn.

## Toolchain

- **Package manager: pnpm `10.32.1`** (a workspace). Never use `npm` or `yarn`.
- **Node 20+**, **Docker**, and the authenticated **`gh` CLI** (issues and PRs).

```bash
pnpm install            # install all workspaces
pnpm shared:build       # build @zenflow/shared — run BEFORE typechecking FE/BE
pnpm -r build | typecheck | test     # run a script across all packages
pnpm --filter backend <script>       # target one app (also: frontend)
```

Per-app scripts: backend `start:dev | typecheck | lint | test | test:e2e | prisma:dev:*`;
frontend `dev | build | typecheck | lint | test:e2e`.

## Critical invariants

1. **`@zenflow/shared` is the API contract.** Request/response types (`CreateSessionInput`,
   `SessionsListResponse`, `RescheduleResponse`, `ApiSuccess`/`ApiError`, …) live in
   `packages/shared/src`. Change them there, then `pnpm shared:build` so both FE and BE see
   the new types. Don't duplicate these shapes in either app.

2. **Ranking lives in Python; Nest is thin (ADR-0003).** All placement ranking — heuristic
   best slot, LinUCB slot-first scoring, series spreading, displacement — is implemented in
   `services/bandit/src/core/*`, which is pure numpy: `now` is a parameter, no I/O, no clock,
   no randomness. `backend/src/scheduler/io/*` gathers inputs (day loads, preference matrix,
   observation count, bandit `(A, b)`), calls `POST /v1/place` through `PlacementClient`,
   applies and persists the result, and owns the only RNG (`ExperimentService.assignPolicy`).
   `backend/src/scheduler/core/*` is the calendar/recurrence/preference-write toolbox
   (`slot.ts`, `horizon.ts`, `recurrence.ts`, `matrix-decay.ts`, `sync-conflicts.ts`, …) plus a
   **frozen** heuristic fallback (`slot-score.ts`, `preference.ts`, `series-spread.ts`, the
   pre-#62 behaviour), used only when Python is unavailable (`FallbackPlacer`, built on
   `HeuristicPlacer`); it stays pure (no I/O, clock, or randomness) and takes `now` as a
   parameter. Do not add ranking logic to Nest. See [backend/README.md](backend/README.md) →
   "Scheduler architecture".

   **Ranking change => Python change + Python tests + contract fixtures.** Behaviour changes
   to scoring or placement go in `services/bandit/src/core/*` with pytest coverage and updated
   `packages/shared/contract/place/*.json` fixtures — not a TS↔Python port. The frozen TS
   fallback does not follow this rule: its files (`slot-score.ts`, `preference.ts`,
   `series-spread.ts`, `sync-conflicts.ts`) change only for bug fixes, and a fix must keep
   `backend/test/golden/scheduler-core.golden.json` (regenerate via
   `pnpm --filter backend golden:export`; `golden-fixtures.spec.ts` fails on drift) and
   `services/bandit/tests/test_golden_ts.py` green.

3. **Durations are always positive multiples of 15** (minutes). Slots are 15-minute;
   `DAILY_HORIZON` = 1440. Don't introduce off-grid times.

4. **Two kinds of series.** A multi-sitting `TASK` (`sessionCount > 1`) is *materialized* — one
   real `Session` row per sitting, all sharing a `seriesId`, each scheduled independently. A
   recurring **fixed** session (`DND` / `ASSIGNMENT` / `EXAM` / `LECTURE` with an `rrule`) is
   *virtual* — one `SessionSeries` holds the `rrule` + `exdates`, one representative `Session`
   row anchors the first occurrence, and `SessionsService.list()` fans it out into occurrences
   whose `id` is `"<seriesId>::<startISO>"`. Editing/deleting such an occurrence id is routed by
   the backend: `PATCH` applies series-wide (time-of-day re-anchors, doesn't drop occurrences);
   `DELETE` on the occurrence id adds it to `exdates` ("this one");
   `DELETE /sessions/series/:id/truncate?from=<ISO>` pulls the rrule `UNTIL` back ("this and
   following"); `DELETE /sessions/series/:id` drops the whole series.

5. **Timezone wall-clock rule (frontend).** All calendar `Date`s carry the user-tz wall
   clock in their local fields — go through `frontend/src/utils/tz.ts`, never a bare
   `new Date()` in day/grid logic. Convert back with `zonedWallClockToUtc` before calling
   the API.

6. **API response envelope.** Backend controllers return
   `{ success: true, message, data }`; errors are `{ success: false, message, … }`. Let
   NestJS `HttpException`s propagate.

7. **A live `TASK` always has a `scheduledStartTime`.** A null start is a corrupt row. Pre-flights
   may still reject a create/edit before anything is written; once a row exists, placement ends in
   a real slot or the last resort (`ACCEPTED_LAST_RESORT` / `lastResortStart`), and a placement
   that throws discards the just-inserted rows (`placeOrDiscard`). Don't add a path that writes
   `null` onto a `TASK`. Repair old rows with `pnpm --filter backend backfill:unplaced`.

8. **Auth is OTP + Redis sessions** (no passwords/JWT). Protected routes use
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
  DB). Frontend e2e is Playwright in `frontend/e2e/` (needs the backend stack + Mailpit).
- Run `pnpm --filter <app> typecheck` and `lint` before finishing. After editing shared
  types, `pnpm shared:build` first.
- **Formatting:** ESLint (+ Prettier on the backend), 2-space indentation (`.editorconfig`);
  frontend uses the `@/…` import alias. **Commits** follow
  [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/)
  (`type(scope): summary`). Full guidelines: [CONTRIBUTING.md](CONTRIBUTING.md).

## Where things run

- API → `http://localhost:5000`; Swagger UI → `http://localhost:5000/api`.
- Frontend dev → `http://localhost:5173` (`VITE_API_URL` points at the API).
- Mobile dev → `http://localhost:8081` (Expo/Metro, web target only —
  `EXPO_PUBLIC_API_URL` points at the API; native iOS/Android isn't
  origin-based). Backend `CORS_ORIGIN` (`.env.dev`) is a comma-separated list
  (split in `main.ts`) and must contain both dev web origins.
- OTP login emails are caught by Mailpit (UI/API on `:8025`) in the local Docker stack.
- Native push (`backend/src/devices/`, `POST`/`DELETE /devices`): Android via
  `FCM_SERVICE_ACCOUNT`, iOS via `APNS_KEY` + `APNS_KEY_ID` + `APNS_TEAM_ID` +
  `APNS_BUNDLE_ID` (+ `APNS_PRODUCTION`). All optional — each provider
  self-disables when its vars are unset, like `BANDIT_SERVICE_URL`; unset in
  `.env.test`. `PushService` fans every notification out over the same emitter
  the SSE stream uses.

## Docs

Update the matching README/ADR when a change touches schema, endpoints, the scheduler, screens, conventions or the ML roadmap.

- Two audiences: user-facing (root `README.md`) and dev-facing (everything else). Say who it is for.
- Lead with what the reader does. Bullets, tables and code blocks over paragraphs; no history, no justification essays.
- Link to the source of truth instead of restating it. Keep every real fact: commands, env vars, invariants, limits.
- Don't over-correct: shorten wording, not information.
- ADRs follow [docs/adr/TEMPLATE.md](docs/adr/TEMPLATE.md): Status, Date, Context, Decision, Consequences.

The `docs` skill applies these rules.

## Agents, skills, hooks

Source of truth is `.agents/` (tool-neutral). After editing it run `pnpm sync:agents`; it generates `.claude/`, `.mcp.json` and `.codex/`. See [.agents/README.md](.agents/README.md).

Skills are small and independent; use any in any order:

| Skill | Does |
| --- | --- |
| `issue` | File or refine a GitHub issue (`gh`) from the templates |
| `adr` | Write an ADR |
| `diagram` | Update a diagram in `docs/architecture` |
| `mockup` | Design a mobile screen as HTML in `mockups/` |
| `review` | Review a diff, branch or PR |
| `e2e` | Write and run e2e tests |
| `commit` | Split changes into focused commits |
| `pr` | Open a PR from the template |
| `docs` | Write or tighten docs |

Hooks (`.agents/hooks/`): `enforce-owner` keeps subagents inside their domain (and nudges the main thread), `format-on-edit` runs prettier and `prisma generate`, `guard-git-staging` blocks `git add -A` and `commit -a`. Type-check yourself with `pnpm check`.

MCP: only Playwright (`.agents/mcp.json`). GitHub work uses `gh`.
