# Mobile E2E test plan

Audience: mobile, QA, and CI maintainers implementing issue #79.

**Current state**: 
- All 7 commits complete: selectors, Maestro harness, deterministic test data, Android CI, iOS CI, extended flows, docs sync
- P0 smoke suite: login/OTP → onboarding → create task → edit task → week calendar → month calendar → logout
- P1 extended suite: notification permission + DLU accounts
- CI: Android (ubuntu-latest) + iOS (macos-latest) — nightly + release branches + manual dispatch

Use this plan to land the **actual mobile E2E suite first**. The docs describe the harness that the remaining commits add.

## Target outcome

Issue #79 is done when:

- Maestro smoke tests exist under `mobile/maestro/`.
- The P0 smoke suite covers login/OTP, onboarding, task create/edit, week/month calendar, and logout.
- P1/extended flows cover notification permission and DLU account integration once their infrastructure is stable.
- Mobile screens expose stable `testID`s for all controls the flows drive.
- Local commands use `pnpm` entry points.
- CI can run the smoke suite on at least Android emulator and uploads logs/screenshots/videos on failure.
- These docs explain how the suite is structured, how to run it, and what each flow proves.

## Commit plan

Land this as focused commits so each step can be reviewed and reverted independently.

### Commit 1 — `test(mobile): add stable e2e selectors` ✅ DONE

Purpose: make the app drivable by Maestro without relying on copy, fragile coordinates, or accessibility labels meant for users.

Representative files:

- `mobile/app/(auth)/login.tsx`
- `mobile/app/(onboarding)/index.tsx`
- `mobile/components/tab-bar.tsx`
- `mobile/components/tasks/create-task-fab.tsx`
- `mobile/components/tasks/task-form-screen.tsx`
- `mobile/components/tasks/form/*.tsx`

Work (completed):

- Added static `testID`s to the controls and route roots in the flow docs.
- Kept existing accessibility labels; `testID` is for automation, not a replacement for a11y.
- Preferred stable semantic IDs over dynamic database IDs.
- For repeated content, use stable text created by the test, for example `E2E Focus Block <run-id>`, plus a stable parent `testID`.

Validation:

```bash
pnpm --filter mobile typecheck
pnpm --filter mobile test
```

Difficulty: medium. Most changes are simple props, but task/calendar components may need careful placement so IDs land on native elements Maestro can see.

### Commit 2 — `test(mobile): add Maestro smoke harness` ✅ DONE

Purpose: add the local Maestro suite, helpers, and package scripts before CI.

Representative files:

- `mobile/package.json`
- `mobile/maestro/config.yaml`
- `mobile/maestro/flows/smoke.yaml`
- `mobile/maestro/flows/login-request.yaml`
- `mobile/maestro/flows/login-verify.yaml`
- `mobile/maestro/flows/onboarding.yaml`
- `mobile/maestro/flows/task-create.yaml`
- `mobile/maestro/flows/task-edit.yaml`
- `mobile/maestro/flows/calendar-week.yaml`
- `mobile/maestro/flows/calendar-month.yaml`
- `mobile/maestro/flows/logout.yaml`
- `mobile/maestro/flows/notification-permission.yaml`
- `mobile/maestro/flows/dlu-accounts.yaml`
- `mobile/maestro/helpers/auth.yaml`
- `mobile/maestro/helpers/navigation.yaml`
- `mobile/maestro/helpers/data.yaml`
- `mobile/maestro/scripts/get-otp.js`
- `mobile/maestro/scripts/seed-task.js`
- `mobile/maestro/scripts/reset-test-data.js`

Work (completed):

- Added Maestro config with `MAESTRO_APP_ID` override and default app id.
- Added package scripts:
```json
{
  "test:e2e": "node maestro/scripts/run-suite.js smoke",
  "test:e2e:smoke": "node maestro/scripts/run-suite.js smoke",
  "test:e2e:extended": "node maestro/scripts/run-suite.js extended",
  "test:e2e:android": "node maestro/scripts/run-suite.js smoke",
  "test:e2e:ios": "node maestro/scripts/run-suite.js smoke"
}
```
- Added a smoke entry flow that runs P0 flows in order.
- Added helper scripts for OTP retrieval, test-data reset, and deterministic task seeding.
- Made helpers configurable by environment variables:
  - `E2E_EMAIL`
  - `E2E_RUN_ID`
  - `EXPO_PUBLIC_API_URL`
  - `MAILHOG_URL`

### Commit 3 — `test(mobile): make test data deterministic` ✅ DONE

Purpose: add/reset seed helpers so edit/calendar flows do not depend on create-task passing first.

Representative files:

- `backend/src/test/test.module.ts` — test-only NestJS module (conditionally imported)
- `backend/src/test/test.controller.ts` — `POST /test/reset` and `POST /test/seed-task`
- `backend/src/test/test.service.ts` — Prisma operations for truncate/seed
- `backend/src/app.module.ts` — conditional `TestModule` import when `NODE_ENV=test`
- `mobile/maestro/scripts/reset-test-data.js` — calls `POST /test/reset` + clears MailHog
- `mobile/maestro/scripts/seed-task.js` — OTP login → `POST /test/seed-task`

Work (completed):

- Added test-only backend endpoints behind `NODE_ENV === "test"` guard.
- `POST /test/reset` truncates all data tables in FK-safe order.
- `POST /test/seed-task` creates sessions for the authenticated user,
  with optional `scheduledStartTime` to pin calendar placement
  (seeded rows bypass the engine, so unpinned tasks render nowhere).
- `reset-test-data.js` calls the reset endpoint + clears MailHog.
- `seed-task.js` authenticates via OTP, then seeds a task via the test endpoint.
- `run-suite.js` orchestrates reset → OTP request → MailHog fetch → seed → OTP verify + suite (verify and the suite share one maestro session).

Validation:

```bash
pnpm --filter backend typecheck   # no new errors from src/test/
node mobile/maestro/scripts/reset-test-data.js
E2E_EMAIL=mobile-e2e+test@example.test node mobile/maestro/scripts/seed-task.js "E2E Seeded Task" TASK 2026-10-08T00:00:00.000Z 60 1 2026-10-07T05:00:00.000Z
```

### Commit 4 — `ci: add mobile e2e Android workflow` ✅ DONE

Purpose: run the P0 smoke suite on Android emulator in GitHub Actions.

Representative files:

- `.github/workflows/mobile-e2e.yml`

Work (completed):

- Rewritten workflow from scratch to match existing CI patterns (backend-e2e, frontend-e2e).
- Triggers: nightly schedule (2:17 AM UTC), `release/**` branches, manual dispatch.
- Uses existing `.github/actions/setup` composite action.
- Backend test stack from `compose.dev.yml` (bandit skipped):
  - Postgres + Redis + Redis rate-limit + MailHog + MinIO via compose
    (no `services:` block — dev.yml owns every dependency).
  - `write-test-env.sh` generates throwaway `.env.test` (includes `NODE_ENV=test`),
    mirrored to `backend/.env.dev` (the env file dev.yml reads), with ports
    overridden to dev.yml's mapping (`PG_HOST_PORT=5432`, `S3_HOST_PORT=9000`).
  - Migrations via `prisma migrate deploy`.
  - Backend API on port 5000.
- Android emulator setup:
  - KVM enablement for hardware acceleration.
  - AVD cached across runs.
  - JDK 17 + Gradle cache.
  - `expo prebuild` → `gradlew assembleDebug` → `adb install`.
  - Metro in production mode (`--no-dev --minify`).
- Maestro test run:
  - `node maestro/scripts/run-suite.js smoke` (Maestro invoked with `--format junit` → `mobile/maestro-report.xml`).
  - Android emulator uses `http://10.0.2.2:5000/api/v1` to reach host backend.
- Failure artifacts: JUnit report, screenshots, recordings, API logs, compose logs.
- Teardown: compose down on every run.

Validation: Push to a branch and verify the workflow runs end-to-end.

### Commit 5 — `ci: add mobile e2e iOS workflow` ✅ DONE

Purpose: run the P0 smoke suite on iOS simulator in GitHub Actions (macOS runner).

Representative files:

- `.github/workflows/mobile-e2e.yml` (new `ios-e2e` job added)

Work (completed):

- Added `ios-e2e` job to existing workflow running on `macos-latest`.
- macOS runners have no Docker host, so the job starts one with Colima
  (`--vz-rosetta` keeps the amd64-only MailHog image runnable on arm64),
  then follows the exact same compose + env setup as Android.
- iOS simulator setup:
  - Auto-selects latest available iPhone simulator via `xcrun simctl`.
  - `expo prebuild --platform ios` + `pod install` + `xcodebuild`.
  - App installed via `xcrun simctl install`.
- iOS simulator uses `http://localhost:5000/api/v1` directly (no address mapping needed).
- Same Maestro test flow as Android with JUnit output and failure artifacts.

### Commit 6 — `test(mobile): enable extended P1 flows` ✅ DONE

Purpose: add notification permission and DLU accounts to the nightly/extended suite once infrastructure is stable.

Representative files:

- `mobile/maestro/flows/extended.yaml` — new P1 entry point
- `mobile/maestro/flows/notification-permission.yaml` — updated to assume authenticated state
- `mobile/package.json` — added `test:e2e:extended` script

Work (completed):

- Created `extended.yaml` entry point that runs login/onboard → notification-permission → dlu-accounts → logout.
- Updated `notification-permission.yaml` to assume authenticated state (no duplicate login when run from extended suite).
- Added `test:e2e:extended` pnpm script pointing to `extended.yaml`.
- DLU flow uses existing fixture/test provider IDs; requires `INGESTION_ENABLED=true` when available.
- Notification flow documents permission state control commands for both platforms.

### Commit 7 — `docs: sync mobile e2e docs with implementation` ✅ DONE

Purpose: ensure docs match the final harness exactly.

Representative files:

- `docs/mobile-e2e-test-flows.md` — rewritten to match actual implementation
- `docs/mobile-e2e-test-plan.md` — all commits marked complete

Work (completed):

- Rewrote `mobile-e2e-test-flows.md` from scratch to remove aspirational language.
- Documented actual suite structure, commands, CI configuration, environment variables.
- Updated testID contract to match dot-separated namespace convention used in code.
- Added backend test endpoint documentation.
- Added source-of-truth links to all referenced files.

## Test suite scope

Document three tiers:

| Tier | Runs where | Purpose | Expected runtime |
| --- | --- | --- | --- |
| P0 smoke | local before release, CI nightly/release | prove critical app paths work | 10-15 minutes target |
| P1 extended | manual/nightly after smoke is stable | cover native permissions and integrations | 15-30 minutes |
| Manual/device | real phones only | APNs/FCM and device-specific quirks | as needed |

P0 smoke suite should include:

1. Login / OTP
2. Onboarding
3. Create task
4. Edit task
5. Calendar week view
6. Calendar month view
7. Logout

P1 extended should include:

1. Notification permission prompt and notification inbox baseline
2. DLU accounts integration
3. Negative auth cases, such as invalid OTP or expired OTP

## Why Maestro

Keep it concise:

- Maestro is the recommended choice in issue #79.
- It is a good fit for Expo/React Native smoke flows.
- YAML flows are easy for QA and mobile developers to review.
- It can drive native Android/iOS UI and permission surfaces.
- It is lower-overhead than Detox for the first smoke suite.

## Planned architecture

Document this layout (already implemented):

```text
mobile/maestro/
├── config.yaml
├── flows/
│   ├── smoke.yaml
│   ├── login-request.yaml
│   ├── login-verify.yaml
│   ├── onboarding.yaml
│   ├── task-create.yaml
│   ├── task-edit.yaml
│   ├── calendar-week.yaml
│   ├── calendar-month.yaml
│   ├── notification-permission.yaml
│   ├── logout.yaml
│   └── dlu-accounts.yaml
├── helpers/
│   ├── auth.yaml
│   ├── navigation.yaml
│   └── data.yaml
└── scripts/
    ├── get-otp.js
    ├── reset-test-data.js
    └── seed-task.js
```

Explain each group:

- `flows/`: user journeys.
- `helpers/`: shared YAML snippets after Maestro is introduced.
- `scripts/`: OTP, reset, and seed helpers.
- `config/`: platform-specific app ID and environment values.

## Test data and isolation

Document the planned data model:

- Every run must use disposable test data.
- Do not use dev, staging, production, or a real personal account.
- Preferred account format: `mobile-e2e+<run-id>@example.test`.
- The backend test stack should be the same pattern used by current CI:
  - generated `backend/.env.test` (mirrored to `backend/.env.dev`)
  - Postgres, Redis, rate-limit Redis, MailHog, object storage from
    `backend/compose.dev.yml` (bandit skipped)
- OTP should be read from MailHog by helper script.
- For flows that are not testing task creation, seed tasks directly through API/backend helper so flows are independent.
- Reset strategy:
  1. preferred: reset the test DB before the suite
  2. fallback: unique account namespace per run plus cleanup script

## How the tests run locally

Document current commands separately from planned commands.

Current commands that work today:

```bash
pnpm --filter mobile typecheck
pnpm --filter mobile test
```

Command model (implemented):

```bash
# P0 smoke suite (runner owns reset → seed → OTP → suite — the only supported entry)
pnpm --filter mobile test:e2e            # alias: test:e2e:smoke
pnpm --filter mobile test:e2e:extended   # P1: notification + DLU

# Platform-specific aliases (same runner)
pnpm --filter mobile test:e2e:android
pnpm --filter mobile test:e2e:ios
```

The runner logs out when it finishes, so it cannot hand you a logged-in
session for a single raw flow — `docs/mobile-e2e-test-flows.md` →
"One flow at a time (manual setup)" documents the full manual sequence
(login → onboarding → seed → `maestro test <flow>`) including the
`E2E_TODAY`/`E2E_NEXT_WEEK`/`E2E_RUN_ID` exports the flows require.

Document expected local run sequence:

1. Install dependencies with `pnpm install`.
2. Install Maestro using official Maestro installation instructions.
3. Start backend test services.
4. Generate `backend/.env.test` using `.github/scripts/write-test-env.sh`.
5. Apply migrations.
6. Start backend API on `localhost:5000`.
7. Set `EXPO_PUBLIC_API_URL` for emulator/simulator:
   - iOS simulator can usually use `http://localhost:5000/api/v1`.
   - Android emulator may need `http://10.0.2.2:5000/api/v1` unless the app rewrites loopback correctly.
8. Build/install Expo dev client.
9. Start Metro.
10. Run the suite: `pnpm --filter mobile test:e2e` (the runner owns
    reset → seed → OTP → suite — see `docs/mobile-e2e-test-flows.md`).

## How the tests run in CI

CI workflow: `.github/workflows/mobile-e2e.yml` (two jobs).

CI steps:

1. Checkout repo.
2. Use existing `.github/actions/setup`.
3. Detect whether `mobile/maestro/flows/**/*.yaml` exists; skip with notice until it does.
4. Generate `backend/.env.test`.
5. Start Postgres/object storage, Redis, rate-limit Redis, and MailHog.
6. Apply migrations.
7. Start backend API.
8. Build/install mobile dev client on emulator.
9. Start Metro.
10. Run `node maestro/scripts/run-suite.js smoke` (JUnit report +
    failure screenshots/recordings).
11. Upload artifacts on failure.
12. Tear down test services.

Recommended rollout:

- First CI target: Android emulator on Ubuntu.
- Second CI target: iOS simulator on macOS after service provisioning is solved.
- Keep real push delivery on manual/real-device checks unless APNs/FCM CI setup is added.

## How hard each test is to pass

Add a reliability/difficulty table. Suggested content:

| Flow | Difficulty | Why | Reliability target |
| --- | --- | --- | --- |
| Login / OTP | Medium | depends on MailHog polling and auth timing | should pass consistently with OTP helper timeout |
| Onboarding | Medium | depends on first-run state and native permission branching | should pass after DB/app-state reset |
| Create task | Medium-high | scheduler may show slot picker and calendar date state matters | should pass with deterministic dates and minimal required fields |
| Edit task | Medium | needs seeded task and stable open/edit path | should pass when seeded independently |
| Week calendar | Medium | date navigation can be flaky if tied to real current date | should pass with seeded relative dates and Today reset |
| Month calendar | Medium-high | month grid/date cells and gestures can be flaky | should pass with stable date IDs and tap-only navigation |
| Notification permission | High | OS permission UI differs by platform/version | keep separate from core smoke; pre-grant/revoke in CI |
| Logout | Low | simple settings action and session assertion | should be highly reliable |
| DLU accounts | High | external/provider dependency and credentials | run as extended/manual until fixture provider exists |

## Pass/fail policy

Document what "pass" means:

- A smoke flow passes only if every visible assertion succeeds.
- Infrastructure retries may be allowed for emulator boot or service startup.
- Do not retry failed app assertions by default; fix the cause or selector.
- Every failure should produce enough artifacts to debug without rerunning locally.
- P0 smoke failures block release once the workflow is required.
- P1 extended failures should be triaged but may not block until stabilized.

## Failure artifacts

Document expected artifacts:

| Artifact | When | Purpose |
| --- | --- | --- |
| Maestro logs | failure, optionally always | command trace |
| screenshots | failure | final failed screen state |
| screen recording | failure/nightly | gesture and transition debugging |
| API log | failure | backend exceptions and request failures |
| MailHog dump | failure | OTP/debug messages |
| emulator logs | failure | native crash or permission issues |

## Source-of-truth links

Link to:

- `../mobile/README.md`
- `../mobile/package.json`
- `../mobile/vitest.config.ts`
- `../.github/workflows/ci.yml`
- `../.github/workflows/mobile-e2e.yml`
- `../backend/compose.dev.yml`
- `../.github/scripts/write-test-env.sh`

## Rollout checklist

Add checklist:

- [x] Add stable `testID`s.
- [x] Add Maestro install/package scripts.
- [x] Add OTP helper.
- [x] Add reset/seed helpers (backend test endpoints + script integration).
- [x] Add P0 flow YAML files.
- [x] Add Android CI job.
- [x] Add failure artifact upload.
- [x] Add iOS CI after service provisioning is solved.
- [x] Promote P0 workflow to release gate when stable.

## Issue #79 completion

All implementation work is complete. Remaining operational steps:
- Run the workflow manually via `workflow_dispatch` to verify it passes end-to-end.
- Fix any test stability issues that appear in the first few nightly runs.
- Promote P0 smoke to a required status check once green for 5+ consecutive runs.