---
name: feature
description: >-
  End-to-end Zenflow feature pipeline. Runs all phases in order: requirements (GitHub issue)
  -> UI/UX (Figma) -> architecture (ADR + diagrams) -> implementation (BE/FE/ML in parallel)
  -> live code review -> QA e2e. Use when asked to "ship a feature", "build <feature>
  end-to-end", or run the whole workflow. For a single phase, use /req-analysis, /ui-ux,
  /arch, /implement, /verify-changes, or /qa.
---

# /feature — full feature pipeline

Orchestrate a feature from request to tested implementation by running each phase's skill in
sequence. **You (the main agent) are the orchestrator** — you spawn subagents via the Agent
tool, carry context forward between phases, and pause for the user at the checkpoints below.

The feature request is the skill argument. Before starting, restate your understanding of the
request in one or two sentences.

## Phases (run in order)

1. **Requirements — `/req-analysis`** → spawn `product-manager` to create the GitHub issue.
   Carry forward: **issue number + URL + acceptance criteria + affected areas (BE/FE/ML)**.
2. **Design — `/ui-ux`** (skip if the feature has no UI surface) → spawn `ui-ux-designer`.
   Carry forward: **new/adjusted screens + component spec + Figma links**.
3. **Architecture — `/arch`** → spawn `solution-architect` to write + commit the ADR with
   diagrams. Carry forward: **ADR path + API/schema deltas + confirmed BE/FE/ML scope**.
4. **Implementation — `/implement`** → spawn `backend-engineer`, `frontend-engineer`, and
   (only if the issue needs it) `ml-engineer` **in parallel**. Each implements its slice,
   writes + runs unit/integration tests, and commits.
5. **Review — `/verify-changes`** → spawn `code-reviewer` (opus) to review the diff and verify
   live behavior, producing a Markdown report. **If the verdict is changes-requested, loop
   back to /implement** with the findings before continuing.
6. **QA — `/qa`** → spawn `backend-qa-engineer` and `frontend-qa-engineer` **in parallel** to
   write + run HTTP/e2e tests in the Docker test environment.

## Orchestration rules
- Pass the GitHub issue number to every downstream phase so all artifacts trace back to it.
- **Checkpoint after Requirements and after Architecture** — show the user the issue and the
  ADR summary and let them confirm/adjust before code is written. (Skip checkpoints only if
  the user said to run unattended.)
- Decide ML involvement from the issue's "affected areas"; don't spawn `ml-engineer` for
  pure CRUD/UI work.
- Each phase's detailed instructions live in its own skill — follow them. If a phase's
  required MCP server (github/figma/playwright) isn't configured, stop and tell the user.
- Summarize at the end: issue, ADR, commits, review verdict, and QA results.
