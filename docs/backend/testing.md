# Backend e2e tests

For: developers adding or running specs in `backend/test/`. Unit specs (`*.spec.ts`) sit next to the code and are not covered here.

Run the whole suite with `backend/e2e.sh` (the same stack CI uses), or against a stack you already started with `pnpm --filter backend test:e2e` (builds `dist/` first). One spec: `pnpm --filter backend exec jest --config ./test/jest-e2e.json <name>` with `.env.test` loaded.

## Stack

`backend/compose.test.yml`: Postgres and MinIO always; the `queue` profile adds the five Redis instances and Mailpit; the `bandit` profile adds the Python placement service on `:8100`. CI starts all of them (`backend-e2e` job) and applies migrations with `migrate deploy`.

Two spec styles:

- **In-process Nest** (`notifications`, `devices`, `tags-onboarding`, `push-delivery`): `Test.createTestingModule` with the real module under test and the externals overridden (FCM and APNs senders, auth guard, an in-memory Prisma stub in the older ones).
- **Real processes** (everything else): `test/queue/support/stack.ts` starts the built `dist/main.js` once per role plus the fake DLU server, logs in through the real OTP flow (code read from Mailpit) and drives the API with supertest. Use `startRole(role, extraEnv)`, `signUp`, `connect`, `openSse`, `until`. `support/db.ts` gives a Prisma client for assertions.

## What each spec covers

| Spec | Covers |
| --- | --- |
| `sessions` | scheduler API on the frozen fallback placer: placement on the 15-minute grid, validation, infeasible handling, TASK series, recurring fixed sessions, reminders on create |
| `sessions-bandit` | the same API through the Python service, and the fall back when it is down. Skipped locally without the service, fails in CI |
| `integrations` | connect, reconnect, update, status and disconnect of LMS and portal accounts; encryption at rest; the upstream being down |
| `ingestion-materialize` | what a sync does to the calendar and inbox: first sync, re-sync, student deletion, withdrawn items, sync conflicts and "reschedule them all" |
| `queue/queue-flow` | ticker, workers, retries, breaker, manual sync, SSE and push job fan-out, graceful shutdown |
| `reminders` | arming by the watcher, firing once, restart safety, the inbox |
| `push-delivery` | which devices get a push, language, dead-token pruning, when a job must retry |
| `notifications`, `devices`, `tags-onboarding`, `rate-limit`, `backup/` | the matching endpoints and the backup service |

## Rules

- Each test signs up its own student. A spec that connects accounts calls `removeStudents(prisma)` in `afterAll`: suites share one database, and a left-over connected student stays due for the next suite's ticker.
- Tests that depend on the clock use times a day out, or wait for the real event with `until`. The one real-time spec is `reminders` (about 3 minutes).
- `POST /_/hide` on the fake DLU server makes the school withdraw items (see `scripts/fake-dlu-server.ts`); reset it in `afterEach`.
- `backend/test/golden/**` belongs to the scheduler owner; do not edit it from a test change.
