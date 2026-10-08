# Contributing to Zenflow

Dev-facing guide: setup, code style, commits, PRs, tests, labels.
Start with [README.md](README.md) and [AGENTS.md](AGENTS.md); each app's README has deeper conventions.

## Prerequisites and setup

- **Node 20+**, **pnpm 10.32.1**, **Docker** (backend stack), authenticated [**`gh` CLI**](https://cli.github.com) (issues and PRs).

```bash
pnpm install            # install all workspaces
pnpm shared:build       # build @zenflow/shared; required before FE/BE typecheck
```

- Bring up the API and frontend: [README quick start](README.md#quick-start).
- Env files (`.env*`) are git-ignored; copy each app's `.env.example`.

## Monorepo commands (repo root)

```bash
pnpm shared:build              # build the shared types package
pnpm -r build                  # build every package
pnpm -r typecheck              # typecheck every package
pnpm -r test                   # test every package
pnpm check                     # shared build + typecheck
pnpm --filter <app> <script>   # one app, e.g. pnpm --filter frontend dev
```

## Code style

- **Comments:** explain why; comment what only for algorithms.
- **Lint:** ESLint (flat config per app). The backend also runs Prettier via `eslint-plugin-prettier`, so `eslint` is the single entry point.
- **Format:** 2 spaces, LF, final newline, UTF-8 ([`.editorconfig`](.editorconfig)). Backend uses double quotes and semicolons (Prettier defaults).
- **Frontend imports:** use the `@/…` alias, not deep relative paths (`../../utils/tz` → `@/utils/tz`).
  - `eslint-plugin-no-relative-import-paths` autofixes it; same-folder `./sibling` stays relative.
- **Cross-package types** belong in `@zenflow/shared`; never redefine an API shape in an app. Run `pnpm shared:build` after changing them.

Run before pushing:

```bash
pnpm --filter backend lint        # eslint --fix (incl. prettier)
pnpm --filter frontend lint       # eslint
pnpm shared:build && pnpm -r typecheck
# then the relevant tests (see Testing)
```

Agent hooks only format on edit; run these checks yourself.

## Commits: Conventional Commits 1.0.0

Follow [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/):

```
<type>(<scope>): <short summary>

[optional body: explain the why]

[optional footer(s)]
```

- **Types:** `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.
- **Scope** (optional, encouraged): the area touched, e.g. `backend`, `frontend`, `shared`, `scheduler`, `calendar`, `auth`, `tasks`, `ml`, `docs`.
- Summary: imperative, lower-case, no trailing period ("add task comments").
- Breaking change: append `!` after the type/scope and/or add a `BREAKING CHANGE:` footer.
- Reference issues in the footer: `Refs #123` / `Closes #123`.

```
feat(calendar): manual-pin drag, overlap conflicts, inline agenda
fix(frontend): open clicked occurrence and compact short blocks
docs: remove v2 draft docs
refactor(scheduler): extract slot math into slot.ts
feat(api)!: rename /tasks reschedule payload field

BREAKING CHANGE: `start` is now `requestedStartTime` in the reschedule body.
```

## Branches and pull requests

- Branch off `master` as `type/short-description` (`feat/task-comments`, `docs/contributing`).
- Keep commits focused; don't mix unrelated changes (a feature plus a repo-wide reformat).
- Before a PR: lint, typecheck, run the relevant tests.
- Update the matching README or ADR when you change schema, endpoints, the scheduler, screens or the ML roadmap.

Opening a PR (`gh pr create` loads [`.github/PULL_REQUEST_TEMPLATE.md`](.github/PULL_REQUEST_TEMPLATE.md); fill every section):

- Title is a Conventional Commit; it becomes the squash commit.
- Lead with the why; link the issue (`Closes #123`).
- Tick the areas touched and give steps to test.
- Lint, `pnpm check` and relevant tests are green before review (CI runs the same).
- One logical change per PR; call out breaking changes with a `BREAKING CHANGE:` footer and a migration path.
- Respect the [AGENTS.md](AGENTS.md) invariants.
- Use a draft while in progress; address review with follow-up commits, not force-pushes.

## Testing

| Layer | Tooling | Command |
| --- | --- | --- |
| Backend unit | Jest `*.spec.ts` beside the code (pure scheduler first) | `pnpm --filter backend test` |
| Backend e2e | supertest via `backend/test/jest-e2e.json` against the Docker test env | `pnpm --filter backend test:e2e` |
| Frontend e2e | Playwright (`frontend/playwright.config.ts`, `testDir` `frontend/e2e/`, no specs checked in yet) against a running stack | `pnpm --filter frontend test:e2e` |
| Mobile | Vitest unit + component (MSW), Maestro e2e (`mobile/e2e/`), see [`docs/mobile/testing.md`](docs/mobile/testing.md) | `pnpm --filter mobile test` / `pnpm --filter mobile e2e` |

- New behaviour needs a test; a bug fix needs a regression test.
- Scheduler changes update the matching `*.spec.ts` in the same commit.

## Issues and labels

Open issues from the [templates](.github/ISSUE_TEMPLATE/) (bug, feature, chore) or `gh issue create`. Every issue has a Scope, Acceptance criteria and a Priority.

| Kind | Labels |
| --- | --- |
| Type | `feature`, `hotfix` (bug), `documentation`, `migration` |
| Area | `frontend`, `backend`, `mobile`, `ml`, `infra`, `devops`, `security`, `l10n`, `notifications`, `testing`, `dx` |
| Priority | `P0-blocker`, `P1-high`, `P2-medium`, `P3-low` |

## Coding agents

Claude Code and Codex share one setup in [`.agents/`](.agents/README.md): domain subagents, small skills and hooks.

- Edit `.agents/`, then run `pnpm sync:agents`.
- CI fails if the generated `.claude/` and `.codex/` drift.
- Conventions: [AGENTS.md](AGENTS.md).
