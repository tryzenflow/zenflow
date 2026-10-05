---
name: review
description: "Review a Zenflow diff, branch or PR against the repo invariants. Use before merging or when asked to check changes. Live app verification only on request."
---

# review

## Input
A diff (default: working tree vs `master`), branch, or PR number (`gh pr diff <n>`).

## Steps
1. Get the changes and their owners: `node .agents/scripts/owner.mjs --diff`.
2. Delegate to the `zenflow-reviewer` agent with the diff and owners; with no agents available, apply its checklist yourself (`.agents/agents/zenflow-reviewer.md`).
3. Run the checks the diff touches: `pnpm -r typecheck`, `pnpm --filter <app> lint`, the touched specs; scheduler/bandit changes also `uv run pytest` in `services/bandit`.
4. If asked for live verification, start the dev stack and drive the changed flow (Playwright MCP for web, emulator for mobile).

## Output
Findings ranked by severity: `path:line`, failure scenario, owning agent. State what was run and what wasn't. Post to the PR only if asked (`gh pr review` / `gh pr comment`).
