# Contributing to Zenflow

Thanks for working on Zenflow! This guide covers local setup, code style, and our commit
convention. For the product overview and architecture, start with [README.md](README.md) and
[AGENTS.md](AGENTS.md); each app has its own README with deeper conventions.

## Prerequisites & setup

- **Node 20+**, **pnpm 10.32.1**, **Docker** (backend stack), and the authenticated [**`gh` CLI**](https://cli.github.com) (issues and PRs).

```bash
pnpm install            # install all workspaces
pnpm shared:build       # build @zenflow/shared — required before FE/BE typecheck
```

See the [root README quick start](README.md#quick-start) to bring up the API + frontend. Env files (`.env*`) are git-ignored; copy from each app's `.env.example`.

## Monorepo commands (from the repo root)

```bash
pnpm shared:build       # build the shared types package
pnpm -r build           # build every package
pnpm -r typecheck       # typecheck every package
pnpm -r test            # test every package
pnpm --filter <app> <script>   # target one app, e.g. pnpm --filter frontend dev
```

## Code style & formatting

- **Comment why, not what**. Only comment what for algorithms, and comment "why" for why a decision is made.
- **Formatter / linter: ESLint** (flat config per app). The **backend** also runs **Prettier**
  via `eslint-plugin-prettier`, so `eslint` is the single entry point for both.
- **Indentation: 2 spaces** (no tabs), LF line endings, final newline, UTF-8 — enforced by
  [`.editorconfig`](.editorconfig). Backend style is double quotes + semicolons (Prettier
  defaults).
- **Frontend import paths:** use the `@/…` alias instead of deep relative paths
  (`../../utils/tz` → `@/utils/tz`). This is autofixed by
  `eslint-plugin-no-relative-import-paths`; same-folder `./sibling` imports stay relative.
- **Cross-package types** belong in `@zenflow/shared` — never redefine an API shape in an app.
  Run `pnpm shared:build` after changing them.

Run before pushing:

```bash
pnpm --filter backend lint        # eslint --fix (incl. prettier)
pnpm --filter frontend lint       # eslint
pnpm shared:build && pnpm -r typecheck
# run the relevant tests (see Testing below)
```

Agent hooks only format on edit; run these checks yourself (`pnpm check` = shared build + typecheck).

## Commit convention — Conventional Commits 1.0.0

We follow [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/). Each
commit message is:

```
<type>(<scope>): <short summary>

[optional body — explain the why]

[optional footer(s)]
```

**Types:** `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`,
`chore`, `revert`.

**Scope** (optional but encouraged) names the area touched, e.g. `backend`, `frontend`,
`shared`, `scheduler`, `calendar`, `auth`, `tasks`, `ml`, `docs`.

**Rules**

- Summary in the imperative mood, lower-case, no trailing period (e.g. "add task comments").
- A commit that introduces a breaking change appends `!` after the type/scope **and/or** adds
  a `BREAKING CHANGE:` footer describing it.
- Reference issues in the footer when relevant: `Refs #123` / `Closes #123`.

**Examples** (consistent with this repo's history):

```
feat(calendar): manual-pin drag, overlap conflicts, inline agenda
fix(frontend): open clicked occurrence and compact short blocks
docs: remove v2 draft docs
refactor(scheduler): extract slot math into slot.ts
feat(api)!: rename /tasks reschedule payload field

BREAKING CHANGE: `start` is now `requestedStartTime` in the reschedule body.
```

## Branching & pull requests

- Branch off `master` using a `type/short-description` name (e.g. `feat/task-comments`,
  `docs/contributing`).
- Keep commits focused; don't mix unrelated changes (e.g. a feature + a repo-wide reformat).
- Before opening a PR: lint, typecheck, and run the relevant tests; update the matching README
  / `services/bandit/README.md` when you change schema, endpoints, the scheduler, screens, or the ML
  roadmap.
- PR descriptions should explain the **why** and link the issue.

### Opening a PR

Fill in every section of [`.github/PULL_REQUEST_TEMPLATE.md`](.github/PULL_REQUEST_TEMPLATE.md) (`gh pr create` loads it).

- Title is a Conventional Commit; it becomes the squash commit.
- Lead with the why; link the issue (`Closes #123`).
- Tick the areas touched and give steps to test.
- Lint, `pnpm check` and relevant tests are green before review (CI runs the same).
- One logical change per PR; call out breaking changes with the `BREAKING CHANGE:` footer and a migration path.
- Respect the [AGENTS.md](AGENTS.md) invariants.
- Use a draft while in progress; address review with follow-up commits, not force-pushes.

## Testing

- **Backend unit:** Jest `*.spec.ts` next to the code (the pure scheduler is the priority to
  cover) — `pnpm --filter backend test`.
- **Backend e2e:** supertest over HTTP via `backend/test/jest-e2e.json` against the Docker
  test env — `pnpm --filter backend test:e2e`.
- **Frontend e2e:** Playwright in `frontend/e2e/` against a running stack —
  `pnpm --filter frontend test:e2e`.

New behavior needs a test; a bug fix needs a regression test. Scheduler changes must update
the matching `*.spec.ts` in the same commit.

## Issues & labels

Open issues from the [templates](.github/ISSUE_TEMPLATE/) (bug, feature, chore) or `gh issue create`. Every issue has a Scope, Acceptance criteria and a Priority.

| Kind | Labels |
| --- | --- |
| Type | `feature`, `hotfix` (bug), `documentation`, `migration` |
| Area | `frontend`, `backend`, `mobile`, `ml`, `infra`, `devops`, `security`, `l10n`, `notifications`, `testing`, `dx` |
| Priority | `P0-blocker`, `P1-high`, `P2-medium`, `P3-low` |

## Coding agents

Claude Code and Codex share one setup in [`.agents/`](.agents/README.md): domain subagents, small skills and hooks. Edit `.agents/`, then run `pnpm sync:agents`; CI fails if the generated `.claude/` and `.codex/` drift. Conventions: [AGENTS.md](AGENTS.md).
