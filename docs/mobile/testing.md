# Mobile testing

Three layers, shaped as a pyramid: many fast tests at the bottom, a handful of slow ones on top.

| Layer | Tool | Where | Runs | Command |
| --- | --- | --- | --- | --- |
| Unit | Vitest (node) | `mobile/lib/__tests__/*.test.ts` | every PR (`ci.yml` → `unit-tests`) | `pnpm --filter mobile test:unit` |
| Component | Vitest + happy-dom + MSW | `mobile/test/screens/*.test.tsx` | every PR (same job) | `pnpm --filter mobile test:component` |
| E2E smoke | [Maestro](https://docs.maestro.dev) | `mobile/e2e/flows/*.yaml` | nightly, `release/**`, manual (`mobile.yml`) | `pnpm --filter mobile e2e` |

`pnpm --filter mobile test` runs the first two.

Put a case at the lowest layer that can catch it. Pure logic (date math, payload mapping, state machines) is a unit test. A screen's behaviour against API responses (validation, error and empty states, navigation) is a component test. Only whole journeys that need a real device, the real API or an OS dialog belong in e2e, and only their happy path: validation, error, empty and offline states are component tests (cheaper, faster, less flaky).

## Component tests

Screens render through `react-native-web` in happy-dom, with the API mocked over HTTP by [MSW](https://mswjs.io). That setup is deliberate: the code under test (axios, interceptors, error mapping, stores) runs unmodified and only the network is faked.

- Config: `mobile/vitest.component.config.ts`. Native-only modules are replaced by stubs in `mobile/test/mocks/` (aliased in the config) and `mobile/test/setup.component.tsx`.
- `mobile/test/msw/handlers.ts` holds happy-path defaults. Override per test with `server.use(...)`. Unmatched requests fail the test (`onUnhandledRequest: "error"`), so a screen can't silently call an endpoint you didn't account for.
- Render with `renderScreen` from `mobile/test/utils/render.tsx` (adds the toast provider). Select elements by `testID` (`getByTestId`); `className` styling is not applied in this environment.
- Keep tests out of `mobile/app/`: expo-router treats every file there as a route.
- Peripheral heavy widgets (language dropdown, settings sections) are `vi.mock`ed per test file.
- A new native import that breaks the environment usually needs a stub in `test/mocks/` plus an alias.

### Cases to cover

Covered now: login (invalid email, OTP request success/server error/429 lockout/offline, verify success/wrong code, change email) and settings sign-out (success, request failure still clears the session).

Still to write, in priority order:

1. **Task create** – required title, deadline required for TASK, `POST /sessions` payload, placement conflict/infeasible error toasts, offline.
2. **Task edit/delete** – form prefilled from `GET /sessions/:id`, `PATCH` payload, delete (plain and recurring scope sheet), 404.
3. **Calendar** – week/month render tasks from `GET /sessions`; loading, empty and error+retry states; cached-offline render.
4. **Onboarding** – step order, skip paths, completion PATCHes `onboarded: true`.
5. **Notification permission** – prompt only once per login, grant registers the device (`POST /devices`), deny does not, blocked state opens system settings.
6. **Session expiry** – any 401/403 clears the user and redirects to login.

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

## CI (`.github/workflows/mobile.yml`)

| Job | When | Output |
| --- | --- | --- |
| `build-android` | PRs touching `mobile/`, nightly, `release/**`, manual | `zenflow-android-apk` → `zenflow-android.apk` |
| `build-ios` | same | `zenflow-ios-simulator-app` → `zenflow-ios-simulator.zip` |
| `e2e-android` | nightly, `release/**`, manual | `maestro-android-results`: junit, failure screenshots, screen recording, logcat, `api.log` |
| `e2e-ios` | `release/**`, or manual with `run_ios_e2e` (advisory) | `maestro-ios-results` |

Builds run on GitHub runners via `expo prebuild` (no Expo/EAS account). It is not part of the required `ci-ok` check.

The default (`e2e`) variant bakes in the emulator-host API URL and allows cleartext HTTP (`plugins/withE2eCleartext.js`, enabled only by `ZENFLOW_E2E=1`). For a build pointed at a real API run the workflow manually with `variant: release` and an `api_url`.

### Android artifact: `.apk`

A release `.apk` you can sideload onto any Android device or emulator (`adb install zenflow-android.apk`). It is signed with the debug keystore the Expo template uses, so it is fine for testing but not for the Play Store (which needs a release keystore and an `.aab`).

### iOS artifact: `.app` vs `.ipa`

- **Simulator `.app` (what CI produces, zipped).** Runs only in the iOS Simulator on a Mac (`xcrun simctl install booted Zenflow.app`). Needs no Apple account.
- **Device `.ipa`.** What you install on a real iPhone or upload to TestFlight/App Store. iOS only runs code signed by Apple, so building one needs a paid Apple Developer account (distribution certificate + provisioning profile) and the real bundle id. Not set up yet; when it is, add an `xcodebuild archive` + `-exportArchive` job gated on those secrets.
