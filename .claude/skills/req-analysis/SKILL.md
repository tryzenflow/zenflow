---
name: req-analysis
description: >-
  Requirements analysis phase. Spawns the product-manager subagent to turn a feature request
  into a well-formed GitHub issue (user stories, scope, acceptance criteria, affected areas)
  via the GitHub MCP. Use when asked to "analyze requirements", "create an issue for a
  feature", or as phase 1 of /feature.
---

# /req-analysis — requirements → GitHub issue

Spawn the **`product-manager`** subagent (Agent tool, `subagent_type: product-manager`) to
analyze the request and open a single GitHub issue.

## Provide the subagent
- The full feature request (verbatim).
- Instruction to ground the issue in `README.md`, `CLAUDE.md`, `backend/README.md`,
  `frontend/README.md`, `docs/heuristic.md`.
- Requirements for the issue: title, problem/motivation, user stories, **scope + affected
  areas (backend / frontend / ML)**, testable **acceptance criteria**, out-of-scope/open
  questions, and labels (`feature` + area labels).

## Prerequisite
The **GitHub MCP** (`github`) must be configured (`.mcp.json`, `GITHUB_PERSONAL_ACCESS_TOKEN`).
If it isn't, stop and tell the user.

## Return to the caller
The **issue number + URL**, the acceptance criteria, and the affected areas — downstream
phases (`/arch`, `/implement`, `/qa`) depend on these.
