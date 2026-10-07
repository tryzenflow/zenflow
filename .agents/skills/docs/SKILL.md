---
name: docs
description: "Write or tighten Zenflow docs (READMEs, docs/, ADRs): user-facing or dev-facing, concise. Use when docs are added, changed or too long."
---

# docs

## Pick the audience
- **User-facing** (root `README.md`): what it does, how to run it, where to read more.
- **Dev-facing** (`CONTRIBUTING.md`, area READMEs, `docs/`): setup, structure, conventions, commands, contracts.

## Rules
- Lead with what the reader does or needs. Cut history, motivation essays and defensive caveats.
- A README is a doorway, not a dump: what it is, how to run it, where the detail lives. Aim for under ~150 lines.
- Move reference detail (endpoint and env tables, schema, flows) to `docs/` and link it; never restate code or another doc.
- No changelogs, history, pasted command output or config dumps in a README.
- Bullets, tables and code blocks over paragraphs; one idea per line; no sentence over ~25 words.
- Link to the source of truth (code path, ADR, other README) instead of restating it.
- Keep every real fact: commands, env vars, invariants, limits. Shorten words, not information.
- Don't over-correct: no empty sections, no stripped-down tables that lose columns readers use.
- Prerequisites include Node 20+, pnpm, Docker and the authenticated `gh` CLI.

## Steps
1. Read the doc and the code it describes; verify commands and paths still exist.
2. Rewrite to the rules; `node .agents/scripts/owner.mjs <paths>` finds who to ask about unclear facts.
3. Check relative links resolve and that README tables still match the code.

## Output
Changed files with line counts before and after, and where any moved detail now lives.
