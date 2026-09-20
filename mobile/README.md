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

## Push & live notifications

The backend (`backend/src/devices/` and `backend/src/notifications/`) drives direct push and live SSE notifications:

- **SSE Live Stream:** The bell badge (`components/notification-bell.tsx`) and inbox (`app/notifications.tsx`) consume `GET /notifications/stream` live via `react-native-sse` wrapped behind `api/notifications.ts` (replaying the session cookie). No `setInterval` polling is used; `GET /notifications` is reserved for initial list, pagination, and `AppState` `active` reconnect catch-up.
- **Detected-items Inbox:** `app/notifications.tsx` matches `mockups/detected-items.html` with topic-specific icons and tints (assignment teal, exam rose, timetable sky, reminder primary), kind badges (`NEW`, `CHANGE`, `DROP`), spelled-out relative time, and `eventEndsAt` labels. Swiping left reveals Dismiss (`DELETE /notifications/:id`) with immediate optimistic removal.
- **Foreground Push & Tap-to-Act Toast:** Live notifications and foregrounded pushes present an in-app tap-to-act toast jumping to the affected calendar session, protected by a deleted-session guard (`GET /sessions/:id`, showing a toast on 404).
- **Native Push Plumbing:** The backend speaks FCM/APNs directly, so the app registers the **raw** device token (`Notifications.getDevicePushTokenAsync()`, not an Expo token) via `POST /devices`.
  - `lib/push.ts` — permission, token, `POST`/`DELETE /devices`.
  - `hooks/use-push-registration.ts` and `hooks/use-notifications.ts` (mounted in `app/_layout.tsx`) handle token lifecycle, background tap routing, and live SSE streaming; sign-out unregisters.
- **Android:** drop `google-services.json` next to `app.config.ts` (auto-detected); absent → push inert.
- **iOS:** `expo-notifications` plugin adds the entitlement; needs a backend APNs key + a real device.
- Adding a native module needs a fresh dev-client build (`pnpm android` / `pnpm ios`).

## Contributing

Biome (`pnpm --filter mobile format`), 2-space indent, Conventional Commits. See the
repo-wide [CONTRIBUTING.md](../CONTRIBUTING.md).

## Divergent slot picker (issue #41)

When the scheduling engine's two placement algorithms (heuristic and LinUCB) propose
**different** slots for a task create or reschedule, the backend returns a
`divergent: true` response with `primarySlot` and `alternativeSlot`. The mobile
app surfaces a bottom sheet (`SlotPickSheet` in `components/calendar/slot-pick-sheet.tsx`)
letting the student choose between the two times — model identities are hidden.

**Flow:**

1. **Create** (`app/task/new.tsx`) or **edit** (`app/task/[id]/edit.tsx`) calls
   `createSession` / `updateSession`. If `response.divergent` is true, the
   `SlotPickSheet` opens before any toast/navigation.
2. **Drag reschedule** (`components/calendar/day-timeline.tsx`): when a drag-drop
   results in a divergent response, `onRequestSlotPick` is called, which opens
   the same sheet from the Week screen (`app/(app)/index.tsx`).
3. The sheet shows two cards — "Currently scheduled" (primary) and "Also fits
   before the deadline" (alternative) — with radio-style selection. Dismissing
   the sheet or tapping "Keep [time]" records `chose: "primary"`. Tapping
   "Switch to [time]" or the alternative card records `chose: "alternative"`.
4. The choice is sent via `POST /sessions/:id/slot-pick` (`api/tasks.ts` →
   `slotPick`). **Failures are non-blocking** — a toast error is shown but the
   task stays at the primary or chosen slot.
5. If `chose: "alternative"`, a success toast appears: "Moved to [time]" +
   "Thanks — noted for next time" (matching `mockups/week-view.html`).

**Key files:**

| File | Role |
|------|------|
| `api/tasks.ts` | `slotPick` client for `POST /sessions/:id/slot-pick` |
| `components/calendar/slot-pick-sheet.tsx` | Bottom sheet UI (two cards, primary/secondary actions) |
| `app/task/new.tsx` | Create flow integration |
| `app/task/[id]/edit.tsx` | Edit flow integration |
| `components/calendar/day-timeline.tsx` | Drag reschedule hook (`onRequestSlotPick`) |
| `app/(app)/index.tsx` | Week screen wires sheet, handles pick, shows toast |
| `lib/task-toasts.ts` | `showAlternativePickToast` for success feedback |
