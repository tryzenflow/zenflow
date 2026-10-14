# Mobile testing

Three layers, shaped as a pyramid: many fast tests at the bottom, a handful of slow ones on top.

| Layer | Tool | Where | Runs | Command |
| --- | --- | --- | --- | --- |
| Unit | Vitest (node) | `mobile/lib/__tests__/*.test.ts` | every PR (`ci.yml` → `unit-tests`) | `pnpm --filter mobile test:unit` |
| Component | Vitest + happy-dom + MSW | `mobile/test/screens/*.test.tsx` | every PR (same job) | `pnpm --filter mobile test:component` |
| E2E smoke | [Maestro](https://docs.maestro.dev) | `mobile/e2e/flows/*.yaml` | nightly, `release/**`, manual (`mobile.yml`) | `pnpm --filter mobile e2e` |

`pnpm --filter mobile test` runs the first two.

Test at the lowest layer that can catch the case:

- **Unit:** pure logic (date math, payload mapping, state machines).
- **Component:** a screen against API responses (validation, error and empty states, navigation).
- **E2e:** whole journeys that need a device, the real API or an OS dialog. Happy path only.

## Component tests

Screens render through `react-native-web` in happy-dom, with the API mocked over HTTP by [MSW](https://mswjs.io). That setup is deliberate: the code under test (axios, interceptors, error mapping, stores) runs unmodified and only the network is faked.

- Config: `mobile/vitest.component.config.ts`. Native-only modules are replaced by stubs in `mobile/test/mocks/` (aliased in the config) and `mobile/test/setup.component.tsx`.
- `mobile/test/msw/handlers.ts` holds happy-path defaults. Override per test with `server.use(...)`. Unmatched requests fail the test (`onUnhandledRequest: "error"`), so a screen can't silently call an endpoint you didn't account for.
- Render with `renderScreen` (`mobile/test/utils/render.tsx`, adds toast and `PortalHost`).
- Fixtures: `makeSession`, `makeNotification` (`mobile/test/fixtures.ts`).
- Select by `testID` (`getByTestId`). `className` is not applied in tests.
- Keep tests out of `mobile/app/`: expo-router treats every file there as a route.
- Peripheral heavy widgets (the rich-text editor, bottom sheets owned by another screen, floating chrome) are `vi.mock`ed per test file.
- Screens that depend on "now" freeze only the clock: `vi.useFakeTimers({ toFake: ["Date"] })` plus `vi.setSystemTime(...)`. Faking timers wholesale breaks MSW and `waitFor`.
- A new native import that breaks the environment usually needs a stub in `test/mocks/` plus an alias.

### Cases to cover

Covered now, by file in `mobile/test/screens/`:

| File | Covers |
| --- | --- |
| `login` | invalid email, OTP request success/server error/429 lockout/offline, verify success/wrong code, change email |
| `onboarding` | step order, name save, skip paths, notifications step (on, blocked, not now), preference saves and rollback, tags bulk, summary "Set up" detour, `onboarded: true` and its failure |
| `week` | header range and today chip, blocks from `GET /sessions` in the user's timezone, tap and recurring-id routing, empty-day add, day switching and "Jump to today", `date` deep link, "Next up" pill |
| `month` | grid and adjacent days, pills, month navigation, "Jump to today", load-failure toast |
| `task-new` | defaults and route-param prefill, validation, `POST /sessions` payload, landing on the placed day, no-slot, infeasible policies and retry, divergent hand-off, error |
| `task-edit` | read-only view, edit and `PATCH`, validation, infeasible retry, delete (one-off, recurring scopes, task sittings) and failure |
| `settings`, `settings-sections`, `preferences-section`, `dlu-accounts` | sign-out; profile edit; finish-setup card; tags; language, timezone, reminder and notification toggle; connect, sync, update and disconnect LMS and portal accounts |
| `notifications` | empty, list, open row, dismiss, select and clear all, sync-conflict "Reschedule them all" |
| `tab-bar` | labels, tab press events, no navigation on the focused tab |

Not covered by component tests, on purpose: pan, long-press and swipe gestures (the gesture-handler and swipeable stubs only simulate taps), and `className` styling.

Still to write:

1. **Notification permission** – prompt only once per login, grant registers the device (`POST /devices`), deny does not, blocked state opens system settings.
2. **Session expiry** – any 401/403 clears the user and redirects to login.
3. **Offline calendar** – cached week/month render with the stale glyph instead of an error toast; editing is hidden (see [offline.md](offline.md) for the toggle).

## E2E (Maestro)

Six flows, one per critical journey: `01-login-otp`, `02-onboarding`, `03-task-create-edit`, `04-calendar-views`, `05-notification-permission`, `06-logout`. Shared steps live in `e2e/subflows/`.

Flows run against the real API. Each run signs up a fresh `e2e-<timestamp>@example.com` user and reads the login code from Mailpit (`e2e/scripts/otp.js`), so nothing needs seeding.

Elements are addressed by `testID` (`id:` in Maestro). Convention: `screen.element`, e.g. `login.email`, `task.save`, `tab.month`. Add a `testID` to any component a flow needs rather than matching on text: the app defaults to Vietnamese.

### Run locally

```sh
# 1. Test stack + API (see AGENTS.md → Tests): Postgres/S3 via backend/compose.test.yml,
#    Redis, Mailpit on :8025, API on :8000.
# 2. Build the app pointing at it, with cleartext allowed (Android emulator → host is 10.0.2.2):
cd mobile
ZENFLOW_E2E=1 EXPO_PUBLIC_API_URL=http://10.0.2.2:8000/api/v1 pnpm android --variant release
# 3. With the emulator booted and the app installed:
pnpm e2e                          # whole suite
pnpm e2e flows/06-logout.yaml     # one flow
```

Install Maestro first: <https://docs.maestro.dev/getting-started/installing-maestro>. Results (junit, screenshots, logs) go to `mobile/e2e/results/` (gitignored).

### Landing page screenshots

`pnpm --filter mobile e2e:screenshots` signs in as a seeded fixture student and writes four WebP shots (`week`, `month`, `settings`, `new-task`) to `backend/src/landing/assets/`, where the landing page picks them up. The flow is `e2e/screenshots/capture.yaml`, the runner `e2e/screenshots.sh`.

- Needs the E2E build on a booted emulator or simulator, plus the dev stack, API and fake DLU server ([fixtures README](../../backend/scripts/fixtures/dlu/README.md)).
- `SEED=1` seeds the first fixture student first; `EMAIL=...` signs in as someone else.
- The runner sets a 09:41 status bar on Android (`adb`) or iOS (`simctl`), and needs `cwebp` (`brew install webp`) for WebP.
- Prefer an Android emulator: the landing page says Android.

## CI (`.github/workflows/mobile.yml`)

| Job | When | Output |
| --- | --- | --- |
| `build-android` | PRs touching `mobile/` or `packages/` (called from `ci.yml`), nightly, `release/**`, manual | `zenflow-android-apk` → `zenflow-android.apk` |
| `e2e-android` | same, except releases | `maestro-android-results`: junit, failure screenshots, screen recording, logcat, `api.log` |
| `build-ios` | nightly, `release/**`, manual with `run_ios_e2e` (simulator `.app`); releases (unsigned `.ipa`). Never in a PR | `zenflow-ios-simulator-app` → `zenflow-ios-simulator.zip`, or `zenflow-ios-unsigned-ipa` → `zenflow-ios-unsigned.ipa` |
| `e2e-ios` | nightly, `release/**`, manual with `run_ios_e2e` (advisory) | `maestro-ios-results` |

In a PR, `ci.yml` calls it after lint, typecheck and unit tests pass, and `CI ok` requires the Android jobs. iOS runs only nightly and on `release/**`.

Builds run on GitHub runners via `expo prebuild` (no Expo/EAS account).

- `e2e` (default): emulator-host API URL, cleartext HTTP allowed (`plugins/withE2eCleartext.js`, `ZENFLOW_E2E=1` only).
- `release`: run the workflow manually. API defaults to `https://zenflow.alphatrann.com/api/v1`, or pass `api_url`.

### Android artifact: `.apk`

A release `.apk` for sideloading (`adb install zenflow-android.apk`). Release builds sign with the keystore from the `ANDROID_KEYSTORE_*` secrets ([releasing.md](../ops/releasing.md#android-signing-and-updates)); without them (PRs, e2e, forks) the Expo debug key is used. The Play Store needs an `.aab`.

### iOS artifact: `.app` vs `.ipa`

- **Simulator `.app` (e2e only, zipped).** Runs only in the iOS Simulator on a Mac (`xcrun simctl install booted Zenflow.app`). Needs no Apple account.

- **Device `.ipa`:** for real iPhones, TestFlight and the App Store. Needs a paid Apple Developer account (certificate and provisioning profile). Not set up.
- **Unsigned `.ipa`** (`zenflow-ios-unsigned.ipa`). A device build with no signature, for sideloading: SideStore/AltStore re-sign it on the phone with a free Apple ID (7-day expiry, push and other paid entitlements unavailable).
