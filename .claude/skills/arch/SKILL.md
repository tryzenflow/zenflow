---
name: arch
description: >-
  Architecture phase. Spawns the solution-architect subagent to write an ADR capturing
  architecture / tech-stack / API-schema changes, draw updated diagrams (use-case, DB schema,
  sequence) in docs/adr, and commit. Use when asked to "update the architecture", "write an
  ADR", "design the API/schema for a feature", or as phase 3 of /feature.
---

# /arch — architecture decision record

Spawn the **`solution-architect`** subagent (Agent tool, `subagent_type: solution-architect`).

## Provide the subagent
- The GitHub issue number + acceptance criteria + affected areas.
- The UI/UX spec from `/ui-ux` if one exists.
- Instruction to ground decisions in `CLAUDE.md` invariants, `backend/README.md`,
  `frontend/README.md`, `backend/prisma/schema.prisma`, `packages/shared/src/*`, and the
  roadmap in `docs/heuristic.md`.

## The deliverable (the subagent produces)
An ADR at `docs/adr/NNNN-<title>.md` containing: status/date/issue link, context, decision +
rejected alternatives, **API schema changes** (`/api/v1` + `@zenflow/shared` types), **data
model changes** (Prisma), consequences, and **Mermaid diagrams**: use-case, updated DB schema
(`erDiagram`), and sequence diagram(s). Then **commit** it.

## Return to the caller
The ADR path, the concrete API/schema deltas, and the confirmed BE/FE/ML scope for
`/implement`. This is a good **checkpoint** — surface the ADR summary to the user before
implementation begins.
