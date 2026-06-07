<!--
Title this PR like a Conventional Commit: type(scope): summary
e.g. feat(calendar): add task comments  •  fix(scheduler): clamp off-grid durations
-->

## What & why

<!-- What does this change do, and why? Lead with the motivation, not the diff. -->

## Related issues

<!-- Link the issue this closes/relates to. -->
Closes #

## Area(s) touched

<!-- Tick what this PR changes. -->

- [ ] `frontend/` (React PWA)
- [ ] `backend/` (NestJS API + EDF scheduler)
- [ ] `packages/shared/` (`@zenflow/shared` — the FE/BE API contract)
- [ ] `services/bandit/` (ML)
- [ ] Docs / tooling / CI

## How to test

<!-- Steps a reviewer can follow to verify this locally. -->

## Checklist

- [ ] Title follows [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/) (`type(scope): summary`)
- [ ] Branched off `master` with a `type/short-description` name; commits are focused (no unrelated changes)
- [ ] `pnpm --filter <app> lint` passes for each touched app
- [ ] `pnpm shared:build && pnpm -r typecheck` passes (rebuilt shared types if I changed them)
- [ ] Added/updated tests — new behavior has a test, a bug fix has a regression test; scheduler changes update the matching `*.spec.ts`
- [ ] Ran the relevant tests (`pnpm --filter backend test` / `test:e2e`, `pnpm --filter frontend test:e2e`)
- [ ] Updated the matching README / `docs/heuristic.md` if I changed schema, endpoints, the scheduler, screens, conventions, or the ML roadmap
- [ ] Respected the critical invariants in [CLAUDE.md](../CLAUDE.md) (pure scheduler, shared types as the contract, 15-min slot grid, response envelope, TZ wall-clock rule)

## Breaking changes

<!-- Describe any breaking change and the migration path, or write "None". -->

None

## Screenshots / recordings

<!-- For UI changes, before/after screenshots or a short clip. Otherwise remove this section. -->
