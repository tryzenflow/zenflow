---
name: adr
description: "Write or update a Zenflow architecture decision record in docs/adr. Use when a change alters architecture, data model, API contract or a scheduling/ML decision."
---

# adr

## Input
The decision, plus the issue or diff that prompted it.

## Steps
1. Read `docs/adr/TEMPLATE.md` and the nearest existing ADRs (0003 for placement, 0004 for storage). Update an existing ADR only to supersede or append an addendum; otherwise take the next number.
2. Write `docs/adr/NNNN-slug.md`: Status, Date, Context, Decision, Consequences. Add `Supersedes`/`Superseded by` when relevant.
3. Name the concrete deltas: `/api/v1` routes, `@zenflow/shared` types, Prisma models, env vars.
4. Link the detail docs (READMEs, `docs/architecture/`) instead of restating them.
5. If a diagram changes, use the `diagram` skill.

## Rules
Decision and consequences, not history or tutorials. One page. Link detail docs instead of restating them; keep READMEs lean (AGENTS.md → Docs).

## Output
The ADR path and the list of deltas for whoever implements it.
