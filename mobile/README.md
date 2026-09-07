# Zenflow Mobile

Expo + React Native app for iOS/Android/web — an active client of the `@zenflow/shared`
contract alongside the web [`frontend/`](../frontend/README.md), sharing calendar and
form logic via [`@zenflow/core`](../packages/core). Part of the
[Zenflow monorepo](../README.md).

---

## Tech stack

| Concern            | Choice                                                                                                            |
| ------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Framework          | Expo SDK 52, Expo Router (file-based, `app/`), React Native 0.76, React 18                                        |
| Styling            | Tailwind CSS **v3** via **[NativeWind](https://www.nativewind.dev) v4**                                           |
| UI primitives      | Hand-rolled shadcn/RN-Reusables-style components in `components/ui/`                                              |
| Fonts              | Geist (all weights) loaded locally from `assets/fonts/` via `expo-font` — see [Fonts](#fonts--font-weights)       |
| Language           | TypeScript (strict, `@/*` → repo-relative alias)                                                                  |
| State              | Zustand (`hooks/use-user-store.ts`, mirrors the web user store)                                                   |
| Forms              | React Hook Form + Zod (`@hookform/resolvers`)                                                                     |
| HTTP               | axios (`api/`), cookie-based session — see [Auth & session](#auth--session)                                       |
| Bottom sheets      | `@gorhom/bottom-sheet` **v5**                                                                                     |
| Date picker        | [`@react-native-community/datetimepicker`](https://github.com/react-native-datetimepicker/datetimepicker) `8.2.0` |
| Rich text editor   | [`@10play/tentap-editor`](https://github.com/10play/10tap-editor) `^1.0.1`                                        |
| Formatter / linter | [Biome](https://biomejs.dev)                                                                                      |

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

`AuthGate` in the root layout (mirrors the web `with-auth.tsx` HOC, driven by the Zustand
user store) gates two route groups. The tab bar (`components/tab-bar.tsx`, custom
glassmorphic pill) has three tabs: **Week**, **Month**, **Settings**.

| Route                  | Screen                       | Notes                                        |
| ---------------------- | ---------------------------- | -------------------------------------------- |
| `/(auth)/login`        | email → OTP                  | timezone captured on verify                  |
| `/(app)` (Week tab)    | `index.tsx`                  | the home screen; day view folded in — no Day route |
| `/(app)/month`         | `month.tsx`                  | Monday-first month grid                      |
| `/(app)/settings`      | `settings.tsx`               | Profile · Appearance · Integrations · Account |
| `/task/new`            | `task/new.tsx` (modal)       | create — 3-tab session-type selector         |
| `/task/[id]/edit`      | `task/[id]/edit.tsx` (modal) | edit — type read-only; series-scope delete   |
| `/notifications`       | `notifications.tsx` (modal)  | DLU LMS / portal notification inbox          |

Session model, series-scope editing, recurrence and the reschedule ("Move to…") flow match
the web client — see [ADR-0002](../docs/adr/0002-scheduling-simplification.md) and
[`frontend/README.md`](../frontend/README.md).

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

**Testing:** Vitest (`vitest.config.ts`, scoped to `lib/**/*.test.ts`) covers the pure,
RN-free logic modules under `lib/__tests__/` — date math, session cache, overdue/peek,
session-series/count/time/type helpers, task-card, task-toasts. Anything importing React
Native or `@gorhom/bottom-sheet` has no automated coverage (no RN test renderer is
configured) — a known gap.

Set `EXPO_PUBLIC_API_URL` in `.env.development` (defaults to
`http://localhost:5000/api/v1`) so the axios client targets the API; on a physical
device/emulator a loopback host is auto-rewritten to the dev machine's LAN address (see
[Auth & session](#auth--session)).

## Contributing

- **Formatter / linter:** [Biome](https://biomejs.dev), not ESLint/Prettier —
  `pnpm --filter mobile format`. 2-space indentation ([`.editorconfig`](../.editorconfig)).
- **Commits:** [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/),
  e.g. `fix(mobile): …`, `feat(mobile): …`.

See the repo-wide **[CONTRIBUTING.md](../CONTRIBUTING.md)** for setup, branching, and testing.
