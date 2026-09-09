# Zenflow Mobile

Expo + React Native app (iOS/Android/web). Shares the `@zenflow/shared` contract and
`@zenflow/core` logic with the web [`frontend/`](../frontend/README.md). Part of the
[Zenflow monorepo](../README.md).

---

## Tech stack

| Concern       | Choice                                              |
| ------------- | -------------------------------------------------- |
| Framework     | Expo SDK 52, Expo Router, React Native 0.76, React 18 |
| Styling       | Tailwind v3 via NativeWind v4                       |
| UI primitives | Hand-rolled shadcn/RN-Reusables in `components/ui/` |
| Fonts         | Geist, local via `expo-font`                        |
| Language      | TypeScript (strict, `@/*` alias)                    |
| State         | Zustand                                             |
| Forms         | React Hook Form + Zod                               |
| HTTP          | axios (`api/`), cookie session                      |
| Bottom sheets | `@gorhom/bottom-sheet` v5                           |
| Date picker   | `@react-native-community/datetimepicker`            |
| Rich text     | `@10play/tentap-editor`                             |
| Formatter     | Biome                                              |

## Project structure

```
mobile/
├── app/                       # Expo Router (file-based)
│   ├── _layout.tsx            # root Stack + AuthGate + providers
│   ├── +not-found.tsx
│   ├── (auth)/_layout.tsx, login.tsx
│   ├── (app)/_layout.tsx      # custom 3-tab bar (Week / Month / Settings)
│   ├── (app)/index.tsx        # Week view (paginated day timeline + 7-day chip strip)
│   ├── (app)/month.tsx        # Month grid
│   ├── (app)/settings.tsx     # flat settings screen
│   ├── task/new.tsx           # create session (modal)
│   ├── task/[id]/edit.tsx     # edit session (modal)
│   └── notifications.tsx      # ingestion inbox (modal)
├── api/                       # auth, tasks, users, tags, files, integrations, notifications
├── components/
│   ├── ui/  primitives/       # hand-rolled shadcn/RN-Reusables primitives
│   ├── calendar/              # day-timeline, week/month pagers, task-block,
│   │                          #   reschedule-sheet, update-recurring-sheet, session-type-badge
│   ├── tasks/                 # task-form-screen, task-sheet-fields, delete-recurring-sheet
│   │   └── form/              # session-type-tabs, recurrence, fixed-time, session-count,
│   │                          #   deadline-chip, duration-stepper, tag-autocomplete, description
│   ├── settings/              # profile-row, integrations-section, settings-header
│   ├── notification-bell.tsx  # floating bell → app/notifications.tsx
│   ├── tab-bar.tsx, tab-icons.tsx, Icons.tsx, logo.tsx, error-boundary.tsx
├── hooks/                     # use-user-store, use-task-form, use-week-day-types, use-now, …
├── lib/                       # api-client, session(-cache), blocks, overlap, peek,
│                              #   week-/month-date-math, timeline-scroll, task-toasts, tag-match, utils
├── plugins/withAndroidBuildFixes.js
├── global.css / tailwind.config.ts / metro.config.js / babel.config.js  # NativeWind wiring
└── components.json / biome.json / vitest.config.ts
```

## Screens & routing

`AuthGate` (root layout, Zustand-driven) gates two route groups. Custom tab bar: **Week**,
**Month**, **Settings**.

| Route               | Screen                      | Notes                                    |
| ------------------- | --------------------------- | ---------------------------------------- |
| `/(auth)/login`     | email → OTP                 | timezone captured on verify              |
| `/(app)` (Week tab) | `index.tsx`                 | home; day view folded in                 |
| `/(app)/month`      | `month.tsx`                 | Monday-first month grid                  |
| `/(app)/settings`   | `settings.tsx`              | profile, appearance, integrations        |
| `/task/new`         | `task/new.tsx` (modal)      | create                                   |
| `/task/[id]/edit`   | `task/[id]/edit.tsx` (modal)| edit; type read-only                     |
| `/notifications`    | `notifications.tsx` (modal) | ingestion inbox                          |

Session model, series-scope editing, recurrence and reschedule match the web client — see
[ADR-0002](../docs/adr/0002-scheduling-simplification.md).

## Local development

```bash
# From repo root, once:
pnpm install

# Mobile scripts (inside mobile/, or `pnpm --filter mobile <script>`):
pnpm dev            # expo start --dev-client --clear
pnpm dev:web        # expo start -c --web       → http://localhost:8081
pnpm dev:android    # expo start -c --android   (reuses an installed dev-client build)
pnpm android        # expo run:android          (full native rebuild — no cache clear, see above)
pnpm ios            # expo run:ios              (macOS only)
pnpm export         # static web export → dist/
pnpm typecheck      # tsc --noEmit
pnpm test           # vitest run — lib/**/*.test.ts only, see below
```

**Testing:** Vitest, scoped to `lib/**/*.test.ts` — pure RN-free logic only. Components
have no automated coverage.

`EXPO_PUBLIC_API_URL` (`.env.development`, default `http://localhost:5000/api/v1`) points
the axios client at the API; a loopback host is auto-rewritten to the dev machine's LAN
address on device/emulator.

## Push notifications

The backend (`backend/src/devices/`) speaks FCM/APNs directly, so the app registers the
**raw** device token (`Notifications.getDevicePushTokenAsync()`, not an Expo token) via
`POST /devices`.

- `lib/push.ts` — permission, token, `POST`/`DELETE /devices`.
  `hooks/use-push-registration.ts` (mounted in `app/_layout.tsx`) registers while signed
  in and deep-links a tapped notification; sign-out unregisters.
- **Android:** drop `google-services.json` next to `app.config.ts` (auto-detected); absent → push inert.
- **iOS:** `expo-notifications` plugin adds the entitlement; needs a backend APNs key + a real device.
- Adding a native module needs a fresh dev-client build (`pnpm android` / `pnpm ios`).

## Contributing

Biome (`pnpm --filter mobile format`), 2-space indent, Conventional Commits. See the
repo-wide [CONTRIBUTING.md](../CONTRIBUTING.md).
