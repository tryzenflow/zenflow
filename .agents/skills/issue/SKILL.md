---
name: issue
description: "Create or refine a Zenflow GitHub issue with gh, using the repo's issue templates and labels. Use when asked to file, write up or sharpen an issue."
---

# issue

Turn a request into one issue that matches `.github/ISSUE_TEMPLATE/`.

## Input
A request, bug report, or an existing issue number to refine (`gh issue view <n>`).

## Steps
1. Pick the template: bug (`hotfix`), feature (`feature`), chore (`dx`).
2. Find the areas: `node .agents/scripts/owner.mjs <paths>` for suspect files, or ask. Map owners to area labels: `scheduler`/`bandit` -> `backend`, `ml`; `campus-sync`, `accounts-api` -> `backend`; `calendar-web` -> `frontend`; `calendar-mobile` -> `mobile`; `platform` -> `infra`, `devops`.
3. Write the body: `## Scope`, `## Acceptance criteria` (`- [ ]` items, each testable), `## Priority` (`**P0-P3**: reason`). Bugs add repro and expected vs actual.
4. Check duplicates: `gh issue list --search "<keywords>" --state all`.
5. Create: `gh issue create --title "type(scope): summary" --body-file - --label <type>,<areas>,<P-label>`.

## Output
The issue URL and number. Don't implement anything.
