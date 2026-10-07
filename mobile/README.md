# Zenflow Mobile

For developers. Expo + React Native app (iOS, Android, web) that shares `@zenflow/shared`
(contract) and `@zenflow/core` (logic) with the web [`frontend/`](../frontend/README.md).
Part of the [Zenflow monorepo](../README.md). Screens are designed first in [`mockups/`](../mockups/).

## Run it

Needs Node 20+, pnpm, and an Android emulator or iOS simulator (iOS needs macOS).
The app uses native modules, so it runs as a **dev client**, not Expo Go.

```bash
pnpm install                          # repo root, once
cp mobile/.env.example mobile/.env.local

# Scripts: inside mobile/, or `pnpm --filter mobile <script>`
pnpm android        # expo run:android: build + install the dev client
pnpm ios            # expo run:ios (macOS only)
pnpm dev            # expo start --dev-client --clear: Metro for an installed client
pnpm dev:android    # expo start -c --android (reuses an installed build)
pnpm dev:ios        # expo start -c --ios
pnpm dev:web        # expo start -c --web -> http://localhost:8081
pnpm ios:personal-team  # prebuild + run on a device with a free Apple team
pnpm export         # static web export -> dist/
pnpm typecheck      # tsc --noEmit
pnpm test           # vitest run (lib/**/*.test.ts only)
pnpm format         # Biome
```

A new native module needs a fresh dev-client build (`pnpm android` / `pnpm ios`).
Components have no automated coverage; Vitest covers pure RN-free `lib/` logic only.

## Environment

| Variable                | Used for                                                                      |
| ----------------------- | ----------------------------------------------------------------------------- |
| `EXPO_PUBLIC_API_URL`   | API base URL (`.env.local`; example `http://localhost:8000/api/v1`)           |
| `EXPO_IOS_BUNDLE_ID`    | Override iOS bundle id (default `com.zenflow.app`) for personal-team builds   |
| `EXPO_APPLE_TEAM_ID`    | Apple team for local device builds (set by `pnpm ios:personal-team`)          |

- A loopback API host is rewritten to the dev machine's LAN address on device/emulator ([`lib/api-client.ts`](lib/api-client.ts)).
- Android push needs `google-services.json` next to `app.config.ts` (absent: push inert).
- iOS push needs the `expo-notifications` plugin, a backend APNs key and a real device.

## Tech stack

| Concern       | Choice                                                                        |
| ------------- | ----------------------------------------------------------------------------- |
| Framework     | Expo SDK 58, Expo Router, React Native 0.88 (New Architecture only), React 19 |
| Styling       | Tailwind v3 via NativeWind v4                                                 |
| UI            | Hand-rolled shadcn/RN-Reusables in `components/ui/` + `components/primitives/` |
| Fonts         | Geist, local via `expo-font`                                                  |
| Language      | TypeScript (strict, `@/*` alias)                                              |
| State / forms | Zustand; React Hook Form + Zod                                                |
| HTTP          | axios (`api/`), cookie session                                                |
| UI libs       | `@gorhom/bottom-sheet` v5, `@react-native-community/datetimepicker`, `@10play/tentap-editor` (rich text) |
| Formatter     | Biome                                                                         |

## Structure

```
mobile/
├── app/            # Expo Router: _layout (AuthGate), (auth), (onboarding), (app) tabs, task/, notifications
├── api/            # the only HTTP layer: auth, tasks, users, tags, files, devices, integrations, notifications
├── components/     # ui/, primitives/ (.native/.web), calendar/, tasks/ (+ form/), settings/, checklist/, onboarding/
├── hooks/          # use-user-store, use-task-form, use-checklist, use-notifications, use-push-registration, ...
├── lib/            # api-client, session, i18n*, push, blocks, overlap, date math, checklist, spotlight, ...
├── plugins/        # Expo config plugins: withAndroidBuildFixes, withIosBuildFixes
├── scripts/        # iOS personal-team helpers
└── global.css, tailwind.config.ts, metro.config.js, babel.config.js   # NativeWind wiring
```

## Routing

`AuthGate` (root layout, Zustand-driven) redirects: signed out to login, signed in without
`onboardedAt` to onboarding, else to the app. Custom tab bar: Week, Month, Settings.

| Route               | Screen                                                                            |
| ------------------- | --------------------------------------------------------------------------------- |
| `/(auth)/login`     | email then OTP; timezone captured on verify                                       |
| `/(onboarding)`     | first-run setup: DLU, name, notifications, timezone (Vietnam time), reminder, tags; the step resumes after an interruption |
| `/(app)` (Week)     | home: paginated day timeline + 7-day chip strip                                   |
| `/(app)/month`      | Monday-first month grid                                                           |
| `/(app)/settings`   | profile, appearance, preferences (language, timezone, default reminder; synced to API), integrations |
| `/task/new`         | create session (modal)                                                            |
| `/task/[id]/edit`   | edit session (modal); type read-only                                              |
| `/notifications`    | ingestion inbox (modal)                                                           |

Session model, series-scope editing, recurrence and reschedule match web: see
[ADR-0002](../docs/adr/0002-scheduling-simplification.md).
Reminders UI is `components/tasks/form/reminder-field.tsx` (hidden for `DND`); labels and the no-duplicate rule come from `@zenflow/core`.

## Getting started checklist

- A "Getting started" pill on Week and Month ([`components/checklist/getting-started.tsx`](components/checklist/getting-started.tsx)) opens a sheet of steps.
- A step ticks itself via `completeStep(id)` ([`hooks/use-checklist.ts`](hooks/use-checklist.ts)) where the action succeeds.
- Steps and copy: [`lib/checklist.ts`](lib/checklist.ts). Ids: `CHECKLIST_STEPS` in `@zenflow/shared` (rebuild it after editing).
- Done steps and `checklist-hidden` live on `User.seenTips` via `PATCH /users/update/basic-info { seenTip }`, so progress follows the user.
- The pill disappears when every step is done or hidden.
- Tapping a step spotlights its control: put `<SpotlightAnchor step="..." />` inside it; [`hooks/use-spotlight.ts`](hooks/use-spotlight.ts) carries the request.
- Steps needing a task (`STEP_NEEDS`) point at the + button until one exists. Placement math: [`lib/spotlight.ts`](lib/spotlight.ts).

## Push and live notifications

Backend: `backend/src/devices/`, `backend/src/notifications/`.

- **SSE:** bell badge and inbox read `GET /notifications/stream` via `react-native-sse` ([`api/notifications.ts`](api/notifications.ts)); no polling. `GET /notifications` is for the initial list and reconnect catch-up.
- **Inbox** ([`app/notifications.tsx`](app/notifications.tsx)): per-topic icon, `NEW`/`CHANGE`/`DROP` badges, relative time, `eventEndsAt`. Swipe left hides the row and offers Undo for 5s before `DELETE /notifications/:id` (flushed on leaving; [`lib/undo-queue.ts`](lib/undo-queue.ts)).
- **Foreground:** a tap-to-act toast jumps to the affected session (404-guarded).
- **Native push:** the backend speaks FCM/APNs directly, so the app registers the raw device token (not an Expo token) via `POST /devices`. See [`lib/push.ts`](lib/push.ts) and the `use-push-registration` / `use-notifications` hooks. Sign-out unregisters.

## Language

- Tiếng Việt is the default; English is selectable on the login screen and in Settings, and applies without resetting navigation or forms.
- Account `User.lang` is authoritative; the cached preference covers pre-login and offline. Login updates the account to the language shown. Failed saves roll back.
- Use `t()` from [`lib/i18n.ts`](lib/i18n.ts) for copy and `useLanguage()` in display components, including memoized ones.
- Use `locale()`, `dateFnsLocale()` and the localized `format()` for display dates. API dates keep their numeric format.
- Dictionaries: [`i18n-vi.ts`](lib/i18n-vi.ts), [`i18n-task.ts`](lib/i18n-task.ts), [`i18n-common.ts`](lib/i18n-common.ts). Shared validation messages translate at the mobile boundary.
- Leave task titles, notes, names, locations and existing tags unchanged; suggested tags follow the language.
- Backend notifications use the account language, so sync the preference before sending.
- Vietnamese on Android uses an in-app date grid; iOS passes the locale to its native picker.

## Accessibility conventions

- Orange or amber **text and icons** use `text-primary-text` / `text-warning` (AA on light surfaces); the brand orange stays for fills. `NAV_THEME` mirrors them for non-className colours.
- Type: `text-label` (11px) and `text-title` (22px) join the stock scale; nothing below 11. Dense chrome passes `maxFontSizeMultiplier={FONT_SCALE_CAP.chrome | grid}` ([`lib/constants.ts`](lib/constants.ts)).
- Respect Reduce Motion with `useReducedMotion` from Reanimated; looping or sliding motion becomes static or instant.
- Small text actions use [`TextLink`](components/ui/text-link.tsx) (44pt target, link role).
- Touch targets are 44pt (a smaller glyph gets `hitSlop` or a 44pt wrapper); selection is never colour alone (check mark, heavier border, `accessibilityState`).
- Reduce Motion in `components/ui` goes through `useMotion` ([`hooks/use-motion.ts`](hooks/use-motion.ts)); haptics through `haptic` ([`lib/haptics.ts`](lib/haptics.ts)).
- `Button` is `rounded-xl`, takes `loading` (spinner, disabled, announced busy) and taps lightly on `default`/`destructive`. Green text uses `text-success-text`.
- Toasts announce themselves; errors, confirms and actionable toasts without a `duration` stay until dismissed or acted on.

## Contributing

Biome, 2-space indent, Conventional Commits: see [CONTRIBUTING.md](../CONTRIBUTING.md).
