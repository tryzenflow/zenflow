---
name: implement
description: >-
  Implementation phase. Spawns the backend-engineer, frontend-engineer, and (only if needed)
  ml-engineer subagents IN PARALLEL to implement a feature from its GitHub issue + ADR, each
  writing and running unit/integration tests and committing its slice. Use when asked to
  "implement the feature", "build it", or as phase 4 of /feature.
---

# /implement — build the feature (parallel BE / FE / ML)

Spawn the area engineers **in parallel** (multiple Agent tool calls in one message). Include
`ml-engineer` **only if** the issue/ADR has ML scope; otherwise just backend + frontend.

- `subagent_type: backend-engineer` — API, DB/Prisma, `@zenflow/shared` types, scheduler.
- `subagent_type: frontend-engineer` — screens/components per the UI/UX spec.
- `subagent_type: ml-engineer` — heuristic/bandit/telemetry work (only when in scope).

## Tell each subagent to
1. Read the **GitHub issue** (acceptance criteria) and the **ADR** (`docs/adr/NNNN-…`) —
   pass the issue number and ADR path.
2. Implement its slice following the area conventions (see its agent definition + the per-app
   READMEs and `CLAUDE.md` invariants).
3. **Write unit + integration tests and run them** (`pnpm --filter backend test` /
   `pnpm --filter frontend typecheck` + relevant suites) until green.
4. **Commit** its own changes with a clear message (`feat(area): … (#<issue>)` + the required
   Co-Authored-By trailer).

## Coordination rules
- If request/response **shapes change, the backend engineer owns `@zenflow/shared`** and runs
  `pnpm shared:build` first; the frontend engineer consumes those types. Sequence or
  communicate this so FE doesn't build against stale types.
- Engineers share one working tree — each commits only the files in its area to avoid
  clobbering. If parallel edits would collide on shared files, run those agents with
  `isolation: "worktree"` or serialize that part.
- After all finish: run `pnpm shared:build && pnpm -r typecheck` and report a combined
  summary (commits per area, tests run). Hand off to `/verify-changes`.
