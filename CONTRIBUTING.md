# Contributing to Zenflow

Thanks for working on Zenflow! This guide covers local setup, code style, and our commit
convention. For the product overview and architecture, start with [README.md](README.md) and
[CLAUDE.md](CLAUDE.md); each app has its own README with deeper conventions.

## Prerequisites & setup

- **Node 20+**, **pnpm 10.32.1**, and **Docker** (for the backend stack).

```bash
pnpm install            # install all workspaces
pnpm shared:build       # build @zenflow/shared — required before FE/BE typecheck
```

See the [root README quick start](README.md#quick-start) to bring up the API + frontend.

## Monorepo commands (from the repo root)

```bash
pnpm shared:build       # build the shared types package
pnpm -r build           # build every package
pnpm -r typecheck       # typecheck every package
pnpm -r test            # test every package
pnpm --filter <app> <script>   # target one app, e.g. pnpm --filter frontend dev
```

## Code style & formatting

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

> If you use Claude Code in this repo, the configured hooks (`.claude/settings.json`) format
> on edit and run `eslint --fix` + a workspace typecheck when a turn ends — but you should
> still run the checks above yourself before opening a PR.

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
  / `docs/heuristic.md` when you change schema, endpoints, the scheduler, screens, or the ML
  roadmap.
- PR descriptions should explain the **why** and link the issue.

### Opening a PR

Opening a PR loads [`.github/PULL_REQUEST_TEMPLATE.md`](.github/PULL_REQUEST_TEMPLATE.md) —
fill in every section rather than deleting the template. A good PR:

1. **Has a Conventional Commit title** — the PR title becomes the squash-merge commit, so it
   must follow `type(scope): summary` just like a commit (see above).
2. **Explains what & why** — lead with the motivation; the diff already shows the *what*.
3. **Links its issue** — `Closes #123` (or `Refs #123`) so the issue auto-closes on merge.
4. **Marks the area(s) touched** — frontend / backend / shared / ML / docs, so the right
   reviewer picks it up.
5. **Tells the reviewer how to test it** — concrete steps to reproduce the behavior locally.
6. **Is green before review** — lint, `pnpm shared:build && pnpm -r typecheck`, and the
   relevant tests all pass; CI runs the same checks.
7. **Stays focused and reasonably small** — one logical change. Split unrelated work into
   separate PRs to keep review fast.
8. **Calls out breaking changes** — if the change is breaking, say so in the PR body, add the
   `BREAKING CHANGE:` footer to the commit, and describe the migration path.
9. **Respects the [CLAUDE.md](CLAUDE.md) invariants** — pure scheduler, `@zenflow/shared` as
   the single API contract, the 15-minute slot grid, the response envelope, and the frontend
   timezone wall-clock rule.

Mark a PR as a **draft** while it's still in progress. Address review feedback with follow-up
commits (don't force-push over a reviewer's in-progress read); the branch is squash-merged, so
intermediate commits are collapsed on merge.

## Testing

- **Backend unit:** Jest `*.spec.ts` next to the code (the pure scheduler is the priority to
  cover) — `pnpm --filter backend test`.
- **Backend e2e:** supertest over HTTP via `backend/test/jest-e2e.json` against the Docker
  test env — `pnpm --filter backend test:e2e`.
- **Frontend e2e:** Playwright in `frontend/e2e/` against a running stack —
  `pnpm --filter frontend test:e2e`.

New behavior needs a test; a bug fix needs a regression test. Scheduler changes must update
the matching `*.spec.ts` in the same commit.

## Optional: the Claude Code feature pipeline

This repo ships a phased pipeline (`.claude/`) — `/feature` runs requirements → design →
architecture → implementation → review → QA, each phase backed by a subagent. See the
"Feature workflow" tables in [README.md](README.md) and [CLAUDE.md](CLAUDE.md).
