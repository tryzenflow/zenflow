# Mobile E2E test flows

Audience: mobile developers and QA authors maintaining the Maestro E2E suite (issue #79).

## Suite structure

```text
mobile/maestro/
├── config.yaml                         # App ID + Maestro settings
├── flows/
│   ├── smoke.yaml                      # P0 entry: verify → … → logout
│   ├── extended.yaml                   # P1 entry: notification + DLU
│   ├── login-request.yaml              # OTP phase 1: email → send code
│   ├── login-verify.yaml               # OTP phase 2: enter ${E2E_OTP}
│   ├── onboarding.yaml                 # First-run setup
│   ├── task-create.yaml                # Create a flexible task
│   ├── task-edit.yaml                  # Edit a seeded task
│   ├── calendar-week.yaml              # Week view navigation (swipe)
│   ├── calendar-month.yaml             # Month view navigation
│   ├── logout.yaml                     # Sign out + verify login screen
│   ├── notification-permission.yaml    # P1: bell → inbox → back
│   └── dlu-accounts.yaml              # P1: DLU section states
├── helpers/
│   ├── auth.yaml                       # Auth snippets
│   ├── navigation.yaml                 # Tab navigation
│   └── data.yaml                       # Data helpers
└── scripts/
    ├── run-suite.js                    # Orchestrator: reset → OTP → seed → suite
    ├── get-otp.js                      # Fetch OTP from MailHog
    ├── reset-test-data.js              # POST /test/reset + clear MailHog
    └── seed-task.js                    # OTP login → POST /test/seed-task
```

## Running locally

### Prerequisites

1. Install dependencies: `pnpm install`
2. Install Maestro: `curl -Ls "https://get.maestro.mobile.dev" | bash`
3. Start backend test stack (dev.yml owns Postgres, Redis ×2, MailHog,
   MinIO — bandit skipped; ports must match dev.yml's mapping, and dev.yml
   reads per-service env from `backend/.env.dev`):

```bash
# Generate throwaway env (dev.yml maps Postgres 5432, MinIO 9000)
PG_HOST_PORT=5432 S3_HOST_PORT=9000 .github/scripts/write-test-env.sh backend/.env.test
cp backend/.env.test backend/.env.dev

# Start services (Windows/macOS: Docker Desktop or Colima running)
cd backend && docker compose -f compose.dev.yml up -d postgres redis redis-ratelimit mail storage && cd ..

# Apply migrations
pnpm --filter backend exec dotenv -e .env.test -- prisma migrate deploy

# Start backend API on port 5000
pnpm --filter backend build
pnpm --filter backend exec dotenv -e .env.test -- env PORT=5000 node dist/main
```

4. Build and install the Expo dev client:
```bash
# Android
cd mobile && npx expo run:android

# iOS
cd mobile && npx expo run:ios
```

5. Start Metro: `pnpm --filter mobile dev`

### Commands

```bash
# P0 smoke suite (reset → OTP → seed → suite, the only supported entry)
pnpm --filter mobile test:e2e

# P1 extended suite (notification + DLU)
pnpm --filter mobile test:e2e:extended

# Raw Maestro is only for developing a single flow AFTER the runner has
# logged in and seeded (it exports E2E_OTP/E2E_TODAY into your shell):
maestro test mobile/maestro/flows/calendar-week.yaml
```

Never run `smoke.yaml`/`extended.yaml` with bare `maestro test`: login is
two-phase (request → fetch OTP from MailHog → verify) and Maestro cannot
run shell mid-suite, so `run-suite.js` owns the sequencing.

### Environment variables

| Variable | Used by | Example |
| --- | --- | --- |
| `MAESTRO_APP_ID` | Maestro app launch | `com.zenflow.app` |
| `EXPO_PUBLIC_API_URL` | device-side API URL (app) | `http://localhost:5000/api/v1` (iOS) or `http://10.0.2.2:5000/api/v1` (Android) |
| `E2E_API_URL` | host-side API URL (reset/seed scripts) | `http://localhost:5000/api/v1` (only differs from above on Android emulator) |
| `MAILHOG_URL` | OTP helper | `http://localhost:8025` |
| `E2E_RUN_ID` | unique titles/email | `local-20261006-001` |
| `E2E_EMAIL` | login OTP | `mobile-e2e+local-20261006-001@example.test` |
| `E2E_OTP` | login-verify (runner exports) | `483920` |
| `E2E_TODAY` | month date-cell IDs (runner exports) | `2026-10-07` |

## Running in CI

CI is configured in `.github/workflows/mobile-e2e.yml` with two jobs.
Both jobs provision the backend from the same file —
`backend/compose.dev.yml` (Postgres, Redis ×2, MailHog, MinIO; the
bandit service is skipped) — plus the shared
`.github/scripts/write-test-env.sh` generator (ports overridden to match
dev.yml's mapping). The generated `.env.test` is mirrored to
`backend/.env.dev` because that is the env file dev.yml reads.

### Android (ubuntu-latest)

- Native Docker: `compose.dev.yml up -d postgres redis redis-ratelimit mail storage`.
- Android emulator: KVM-accelerated, API 34, x86_64, AVD cached across runs.
- Build: `expo prebuild` → `gradlew assembleDebug` → `adb install`.
- Metro in production mode (`--no-dev --minify`).
- Android emulator reaches backend via `http://10.0.2.2:5000/api/v1`
  (host-side scripts use `E2E_API_URL=http://localhost:5000/api/v1`).

### iOS (macos-latest)

- macOS runners have no Docker host, so the job starts one with Colima
  (`--vz-rosetta` keeps the amd64-only MailHog image runnable on arm64),
  then follows the exact same compose + env steps as Android.
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
| Login/OTP | `login-request.yaml` + `login-verify.yaml` | Fresh user reaches onboarding via real OTP from MailHog | Medium |
| Onboarding | `onboarding.yaml` | New user reaches app shell, persists across relaunch | Medium |
| Create task | `task-create.yaml` | Task appears on calendar with deterministic title | Medium-high |
| Edit task | `task-edit.yaml` | Edited task appears with updated title | Medium |
| Week calendar | `calendar-week.yaml` | Swipe paging, seeded tasks render | Medium |
| Month calendar | `calendar-month.yaml` | Month grid, date detail sheet, paging | Medium-high |
| Logout | `logout.yaml` | Returns to login, persists across relaunch | Low |

## P1 extended flow inventory

| Flow | File | Pass condition | Difficulty |
| --- | --- | --- | --- |
| Notification permission | `notification-permission.yaml` | Bell → inbox opens, back returns to Week (OS prompt pre-set, not driven) | High |
| DLU accounts | `dlu-accounts.yaml` | Section/list/rows/status render, sign-in sheet opens (submit is fixture-gated) | High |

## Backend test endpoints

Test-only endpoints registered when `NODE_ENV=test` (via `TestModule` in `app.module.ts`):

| Endpoint | Auth | Purpose |
| --- | --- | --- |
| `POST /test/reset` | None | Truncate all data tables (FK-safe order) + clear for next run |
| `POST /test/seed-task` | CookieAuthGuard | Create sessions for authenticated user |

These endpoints are never available in production builds.

## Stable `testID` contract

Namespace is plural `tasks.*` (matching the code) — not singular `task.*`.
Task cards share one ID across the week block, month pill, and day-sheet
row, computed by `taskCardTestID()` in `mobile/lib/test-ids.ts`: lowercase
the title, collapse every non-`[a-z0-9]` run into one `-`, strip edge `-`.
Test titles must be slug-safe: `E2E … <run-id>` with a lowercase-alphanumeric
`E2E_RUN_ID` (e.g. `E2E Focus Block abc-1` → `calendar.taskCard.e2e-focus-block-abc-1`).

| Area | Element | `testID` |
| --- | --- | --- |
| Auth | email input | `auth.login.emailInput` |
| Auth | request OTP | `auth.login.sendOtpButton` |
| Auth | OTP boxes | `auth.login.otpBoxes` |
| Auth | change email / resend | `auth.login.changeEmailLink` / `auth.login.resendButton` |
| Onboarding | screen root | `onboarding.screen` |
| Onboarding | continue / skip | `onboarding.continueButton` / `onboarding.skipButton` |
| Onboarding | language option | `onboarding.language.option.<value>` (`en`, `vi`) |
| Onboarding | name input | `onboarding.name.input` |
| Onboarding | timezone search / detected | `onboarding.timezone.searchInput` / `onboarding.timezone.detectedOption` |
| Onboarding | reminder option | `onboarding.reminder.option.<minutes>` (`0/5/10/15/30/60`) |
| Onboarding | tags input / add / suggestion | `onboarding.tags.input` / `onboarding.tags.addButton` / `onboarding.tags.suggestion.<slug>` |
| Tabs | Week / Month / Settings | `tabs.week` / `tabs.month` / `tabs.settings` |
| Task | create FAB | `tasks.newButton` |
| Task form | screen root | `tasks.form.screen` |
| Task form | title input | `tasks.form.titleInput` |
| Task form | save (create + edit) / delete | `tasks.form.saveButton` / `tasks.form.deleteButton` |
| Task form | type tab / duration± / deadline chip | `tasks.form.sessionTypeTab.<TASK\|FIXED\|…>` / `tasks.form.durationStepper.increment` / `tasks.form.deadlineChip.<tomorrow\|…>` |
| Slot picker | sheet / option / confirm primary | `tasks.scheduler.sheet` / `tasks.scheduler.slot.<primary\|alternative>` / `tasks.scheduler.pickPrimaryButton` |
| Calendar | week header / today pill | `calendar.week.header` / `calendar.todayButton` |
| Calendar | task card (week+month+sheet) | `calendar.taskCard.<slug>` |
| Calendar | month grid / header / prev / next | `calendar.month.grid` / `calendar.month.header` / `calendar.month.prevButton` / `calendar.month.nextButton` |
| Calendar | month day cell / day sheet | `calendar.month.day.<yyyy-MM-dd>` / `calendar.month.dateDetail` |
| Settings | screen root / sign out | `settings.screen` / `settings.logoutButton` |
| Settings | DLU section / list / row / status | `settings.dluAccounts.section` / `.list` / `.<LMS\|PORTAL>.row` / `.<LMS\|PORTAL>.statusText` |
| Settings | DLU connect / sync / manage | `settings.dluAccounts.<LMS\|PORTAL>.connectButton` / `.syncButton` / `.manageButton` |
| Settings | DLU sign-in sheet | `settings.dluAccounts.signInSheet.<usernameInput\|passwordInput\|submitButton>` |
| Settings | DLU disconnect sheet | `settings.dluAccounts.disconnectSheet.<keepButton\|disconnectButton>` |
| Notifications | bell / screen / inbox / back | `notifications.bell` / `notifications.screen` / `notifications.inbox` / `notifications.backButton` |

Rules:
- `testID` is for automation only — keep existing accessibility labels.
- Use dot-separated namespaces (e.g., `tasks.form.titleInput`).
- Avoid dynamic IDs unless the test created the value.

## Test data strategy

- Every run uses a disposable test email: `mobile-e2e+<run-id>@example.test`.
- `run-suite.js` owns sequencing (Maestro can't shell out mid-suite):
  1. `reset-test-data.js` truncates all tables via `POST /test/reset` and clears MailHog.
  2. `login-request.yaml` sends the OTP on-device.
  3. `get-otp.js` polls MailHog and exports `E2E_OTP`.
  4. `seed-task.js` × 3 pins deterministic sessions via `POST /test/seed-task` with `scheduledStartTime` — seeded rows bypass the placement engine, so without an explicit slot they would render nowhere. Seeds use local noon (same calendar day in any timezone).
  5. `smoke.yaml` / `extended.yaml` starts at `login-verify.yaml`.
- Edit/calendar flows use seeded data so they don't depend on create-task passing.
- OTP is retrieved from the MailHog API — no real email service needed.

## Source-of-truth links

- [`mobile/package.json`](../mobile/package.json) — pnpm scripts
- [`mobile/maestro/config.yaml`](../mobile/maestro/config.yaml) — Maestro config
- [`.github/workflows/mobile-e2e.yml`](../.github/workflows/mobile-e2e.yml) — CI workflow
- [`backend/src/test/`](../backend/src/test/) — test-only endpoints
- [`backend/compose.dev.yml`](../backend/compose.dev.yml) — test services
- [`.github/scripts/write-test-env.sh`](../.github/scripts/write-test-env.sh) — env generator
- [`docs/mobile-e2e-test-plan.md`](./mobile-e2e-test-plan.md) — commit plan and rollout checklist
