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
| `/(app)/settings`   | `settings.tsx`              | profile, appearance, preferences (language, timezone, default reminder — synced to the API), integrations        |
| `/task/new`         | `task/new.tsx` (modal)      | create                                   |
| `/task/[id]/edit`   | `task/[id]/edit.tsx` (modal)| edit; type read-only                     |
| `/notifications`    | `notifications.tsx` (modal) | ingestion inbox                          |

### Getting started checklist

First-run help is a "Getting started" pill floating at the top of Week and Month, left of the
notification bell (`components/checklist/getting-started.tsx`), that opens a sheet of steps grouped Week view /
Month view, each with a one-line how-to.
A step ticks itself off when the user does it — `completeStep(id)` (`hooks/use-checklist.ts`) is
called where the action succeeds: switch day, create a task, drag a task, hold a task, open Month,
open a day, move a task to another day. Steps and copy live in `lib/checklist.ts`; step ids in
`CHECKLIST_STEPS` (`@zenflow/shared`, rebuild it after editing). Done steps (and `checklist-hidden`,
set by "Hide this checklist") are stored on `User.seenTips` via
`PATCH /users/update/basic-info { seenTip }`, so progress follows the user across devices. The pill
disappears when every step is done or it's hidden.

Tapping a step closes the sheet, switches to the screen it lives on and spotlights the control
(dim, how-to bubble with **Got it**): `<SpotlightAnchor step="…" />`
(`components/checklist/spotlight-anchor.tsx`) goes inside that control, and `hooks/use-spotlight.ts`
carries the request. It points at the task you just created (`hooks/use-last-created.ts`) and a step
that needs a task (`STEP_NEEDS`) points at the + button until one exists. Placement math is in `lib/spotlight.ts`.

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

## Push & live notifications

The backend (`backend/src/devices/`, `backend/src/notifications/`) drives direct push and
live SSE:

- **SSE:** the bell badge and inbox consume `GET /notifications/stream` via
  `react-native-sse` (`api/notifications.ts`, session cookie); no polling —
  `GET /notifications` is only for the initial list and reconnect catch-up.
- **Inbox** (`app/notifications.tsx`): per-topic icon/tint, kind badges
  (`NEW`/`CHANGE`/`DROP`), relative time, `eventEndsAt`. Swipe left to dismiss
  (`DELETE /notifications/:id`, optimistic).
- **Foreground:** a tap-to-act toast jumps to the affected session (404-guarded).
- **Native push:** the backend speaks FCM/APNs directly, so the app registers the raw
  device token (not an Expo token) via `POST /devices` — `lib/push.ts` + the
  `use-push-registration`/`use-notifications` hooks handle lifecycle and background tap
  routing; sign-out unregisters.
- **Android** needs `google-services.json` next to `app.config.ts` (absent → push inert).
  **iOS** needs the `expo-notifications` plugin + a backend APNs key + a real device.
- Adding a native module needs a fresh dev-client build (`pnpm android` / `pnpm ios`).

## Contributing

Biome (`pnpm --filter mobile format`), 2-space indent, Conventional Commits. See the
repo-wide [CONTRIBUTING.md](../CONTRIBUTING.md).
- **Reminders:** `components/tasks/form/reminder-field.tsx` — chips (tap to edit in place, × to remove) + a bottom sheet of presets (At start · 15 min … 1 week) and a custom amount/unit; logic (labels, no-duplicate rule) is shared from `@zenflow/core`'s `reminders.ts`. Not shown for `DND`.
