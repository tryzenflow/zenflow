# Mobile E2E test flows

Audience: mobile developers and QA authors maintaining the Maestro E2E suite (issue #79).

## Suite structure

```text
mobile/maestro/
├── config.yaml                         # App ID + Maestro settings
├── flows/
│   ├── smoke.yaml                      # P0 entry: login → … → logout
│   ├── extended.yaml                   # P1 entry: notification + DLU
│   ├── login-otp.yaml                  # OTP auth via MailHog
│   ├── onboarding.yaml                 # First-run setup
│   ├── task-create.yaml                # Create a flexible task
│   ├── task-edit.yaml                  # Edit a seeded task
│   ├── calendar-week.yaml              # Week view navigation
│   ├── calendar-month.yaml             # Month view navigation
│   ├── logout.yaml                     # Sign out + verify login screen
│   ├── notification-permission.yaml    # P1: notification permission
│   └── dlu-accounts.yaml              # P1: DLU account connect/sync
├── helpers/
│   ├── common.yaml                     # Shared utilities
│   ├── auth.yaml                       # Auth helpers
│   ├── otp.yaml                        # OTP retrieval
│   ├── navigation.yaml                 # Tab navigation
│   └── data.yaml                       # Data helpers
└── scripts/
    ├── get-otp.js                      # Fetch OTP from MailHog
    ├── reset-test-data.js              # POST /test/reset + clear MailHog
    └── seed-task.js                    # OTP login → POST /test/seed-task
```

## Running locally

### Prerequisites

1. Install dependencies: `pnpm install`
2. Install Maestro: `curl -Ls "https://get.maestro.mobile.dev" | bash`
3. Start backend test stack:

```bash
# Generate throwaway env
.github/scripts/write-test-env.sh backend/.env.test

# Start Postgres + MinIO
cd backend && docker compose -f compose.test.yml up -d && cd ..

# Apply migrations
pnpm --filter backend exec dotenv -e .env.test -- prisma migrate deploy

# Start backend API on port 5000
pnpm --filter backend build
pnpm --filter backend exec dotenv -e .env.test -- env PORT=5000 node dist/main
```

4. Start Redis and MailHog (if not using service containers):
```bash
redis-server --port 6379 --daemonize yes
redis-server --port 6380 --daemonize yes
# MailHog on ports 1025 (SMTP) and 8025 (API)
```

5. Build and install the Expo dev client:
```bash
# Android
cd mobile && npx expo run:android

# iOS
cd mobile && npx expo run:ios
```

6. Start Metro: `pnpm --filter mobile dev`

### Commands

```bash
# P0 smoke suite (all critical paths)
pnpm --filter mobile test:e2e

# P1 extended suite (notification + DLU)
pnpm --filter mobile test:e2e:extended

# Single flow
maestro test mobile/maestro/flows/login-otp.yaml
```

### Environment variables

| Variable | Used by | Example |
| --- | --- | --- |
| `MAESTRO_APP_ID` | Maestro app launch | `com.zenflow.app` |
| `EXPO_PUBLIC_API_URL` | helper scripts, app | `http://localhost:5000/api/v1` (iOS) or `http://10.0.2.2:5000/api/v1` (Android) |
| `MAILHOG_URL` | OTP helper | `http://localhost:8025` |
| `E2E_RUN_ID` | unique titles/email | `local-20261006-001` |
| `E2E_EMAIL` | login OTP | `mobile-e2e+local-20261006-001@example.test` |

## Running in CI

CI is configured in `.github/workflows/mobile-e2e.yml` with two jobs:

### Android (ubuntu-latest)

- Backend test stack: `compose.test.yml` + `write-test-env.sh` + GitHub Actions service containers (Redis ×2, MailHog).
- Android emulator: KVM-accelerated, API 34, x86_64, AVD cached across runs.
- Build: `expo prebuild` → `gradlew assembleDebug` → `adb install`.
- Metro in production mode (`--no-dev --minify`).
- Android emulator reaches backend via `http://10.0.2.2:5000/api/v1`.

### iOS (macos-latest)

- Backend services: PostgreSQL, Redis, MailHog, MinIO installed via Homebrew (macOS runners lack Docker).
- iOS simulator: auto-selects latest available iPhone, built via `xcodebuild`.
- iOS simulator reaches backend via `http://localhost:5000/api/v1` directly.

### Triggers

| Trigger | When |
| --- | --- |
| Nightly | 2:17 AM UTC daily |
| Release | Push to `release/**` branches |
| Manual | `workflow_dispatch` |

### Failure artifacts

| Artifact | When | Purpose |
| --- | --- | --- |
| Maestro JUnit report | always | test result summary |
| Screenshots | failure | final screen state |
| Recordings | failure | gesture/transition debug |
| API log | failure | backend exceptions |
| Docker compose logs | failure (Android) | service container issues |

## Test tiers

| Tier | Entry point | Purpose | Target runtime |
| --- | --- | --- | --- |
| P0 smoke | `smoke.yaml` | Prove critical paths work | 10-15 min |
| P1 extended | `extended.yaml` | Notification + DLU integration | 15-30 min |
| Manual/device | individual flows | APNs/FCM, device-specific | as needed |

## P0 smoke flow inventory

| Flow | File | Pass condition | Difficulty |
| --- | --- | --- | --- |
| Login/OTP | `login-otp.yaml` | User leaves login via real OTP from MailHog | Medium |
| Onboarding | `onboarding.yaml` | New user reaches app shell, persists across relaunch | Medium |
| Create task | `task-create.yaml` | Task appears on calendar with deterministic title | Medium-high |
| Edit task | `task-edit.yaml` | Edited task appears with updated title | Medium |
| Week calendar | `calendar-week.yaml` | Week navigation, seeded tasks render | Medium |
| Month calendar | `calendar-month.yaml` | Month grid, date detail, navigation | Medium-high |
| Logout | `logout.yaml` | Returns to login, persists across relaunch | Low |

## P1 extended flow inventory

| Flow | File | Pass condition | Difficulty |
| --- | --- | --- | --- |
| Notification permission | `notification-permission.yaml` | Settings accessible, inbox opens, denied doesn't block nav | High |
| DLU accounts | `dlu-accounts.yaml` | Connect/sync/disconnect state transitions work | High |

## Backend test endpoints

Test-only endpoints registered when `NODE_ENV=test` (via `TestModule` in `app.module.ts`):

| Endpoint | Auth | Purpose |
| --- | --- | --- |
| `POST /test/reset` | None | Truncate all data tables (FK-safe order) + clear for next run |
| `POST /test/seed-task` | CookieAuthGuard | Create sessions for authenticated user |

These endpoints are never available in production builds.

## Stable `testID` contract

| Area | Element | `testID` |
| --- | --- | --- |
| Auth | email input | `auth.login.emailInput` |
| Auth | request OTP | `auth.login.requestOtpButton` |
| Auth | OTP input | `auth.login.otpInput` |
| Onboarding | screen root | `onboarding.screen` |
| Onboarding | continue | `onboarding.continueButton` |
| Onboarding | skip | `onboarding.skipButton` |
| Tabs | Week | `tabs.week` |
| Tabs | Month | `tabs.month` |
| Tabs | Settings | `tabs.settings` |
| Task | create FAB | `task.createFab` |
| Task form | screen root | `task.form.screen` |
| Task form | title input | `task.form.titleInput` |
| Task form | submit | `task.form.submitButton` |
| Task form | save | `task.form.saveButton` |
| Settings | screen root | `settings.screen` |
| Settings | sign out | `settings.signOutButton` |
| Notifications | bell | `notifications.bell` |
| Notifications | inbox | `notifications.inbox` |

Rules:
- `testID` is for automation only — keep existing accessibility labels.
- Use dot-separated namespaces (e.g., `task.form.titleInput`).
- Avoid dynamic IDs unless the test created the value.

## Test data strategy

- Every run uses a disposable test email: `mobile-e2e+<run-id>@example.test`.
- `reset-test-data.js` truncates all tables via `POST /test/reset` and clears MailHog before each suite.
- `seed-task.js` authenticates via OTP → seeds tasks via `POST /test/seed-task`.
- Edit/calendar flows use seeded data so they don't depend on create-task passing.
- OTP is retrieved from MailHog API — no real email service needed.

## Source-of-truth links

- [`mobile/package.json`](../mobile/package.json) — pnpm scripts
- [`mobile/maestro/config.yaml`](../mobile/maestro/config.yaml) — Maestro config
- [`.github/workflows/mobile-e2e.yml`](../.github/workflows/mobile-e2e.yml) — CI workflow
- [`backend/src/test/`](../backend/src/test/) — test-only endpoints
- [`backend/compose.test.yml`](../backend/compose.test.yml) — test services
- [`.github/scripts/write-test-env.sh`](../.github/scripts/write-test-env.sh) — env generator
- [`docs/mobile-e2e-test-plan.md`](./mobile-e2e-test-plan.md) — commit plan and rollout checklist
