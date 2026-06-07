---
name: qa
description: >-
  QA phase. Spawns the backend-qa-engineer and frontend-qa-engineer subagents IN PARALLEL to
  write end-to-end tests — real HTTP requests (supertest) and real-UI Playwright flows — run
  in an isolated Docker test environment. Use when asked to "QA the feature", "write e2e
  tests", or as phase 6 of /feature.
---

# /qa — end-to-end QA (parallel backend + frontend)

Spawn both QA subagents **in parallel** (two Agent tool calls in one message):

- `subagent_type: backend-qa-engineer` — API e2e over real HTTP (supertest), run via
  `backend/test/jest-e2e.json` against the Docker **test** env (`compose.test.yml` + `.env.test`).
- `subagent_type: frontend-qa-engineer` — Playwright e2e driving the real UI (which makes
  real HTTP calls), run against the isolated Docker test stack.

## Tell each subagent to
1. Read the **GitHub issue** acceptance criteria (pass the issue number) and the relevant
   area docs.
2. Bring up the **separate Docker test environment** (never the dev/prod DB), write e2e tests
   covering each acceptance criterion (happy path, validation/auth failures, key calendar /
   scheduler flows), and **run them until green**.
3. **Commit** the tests (`test(area): e2e for <feature> (#<issue>)` + Co-Authored-By trailer),
   then tear the environment down.

## Constraints (pass through)
- Backend tests MUST hit the HTTP layer (supertest), not call services directly.
- Frontend tests drive the real UI → real HTTP; no API mocking.
- Isolated Docker test env only; deterministic, independent specs.

## Return to the caller
Combined pass/fail per acceptance criterion and the committed test files.
