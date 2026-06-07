---
name: verify-changes
description: >-
  Live code-review phase. Spawns the code-reviewer subagent (opus) to read the diff AND verify
  live behavior — bring up the dev Docker stack + frontend dev server and drive the running
  app via the Playwright MCP — then generate a Markdown review report. Use when asked to
  "review and verify the changes", "verify live behavior", or as phase 5 of /feature. (Named
  to avoid shadowing the built-in /verify and /code-review.)
---

# /verify-changes — diff review + live verification

Spawn the **`code-reviewer`** subagent (Agent tool, `subagent_type: code-reviewer`; it runs
on the opus model per its definition).

## Provide the subagent
- The GitHub issue number + acceptance criteria (the live checks to perform).
- The branch / diff base to review (e.g. `git diff main...HEAD`).

## The subagent will
1. Review the diff against `CLAUDE.md` invariants and the per-app conventions.
2. Bring up the dev stack (`backend` → `docker compose up -d`) and the frontend dev server,
   then drive the running app with the **Playwright MCP** to verify each acceptance criterion
   (log in via the MailHog OTP, exercise the new flow), capturing evidence.
3. Write a Markdown report to `docs/reviews/<branch-or-issue>-review.md`: verdict, findings
   by severity with `file:line`, per-criterion live results, follow-ups. Then tear down.

## Prerequisite
The **Playwright MCP** (`playwright`) and Docker must be available.

## Return to the caller
The report path and the verdict. **If the verdict is changes-requested, loop back to
`/implement`** with the findings before proceeding to `/qa`.
