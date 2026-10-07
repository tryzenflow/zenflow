# Zenflow Web (frontend)

For developers. React 19 + Vite PWA, the desktop calendar client.
Users create sessions, the backend places flexible tasks into open slots, and drag/resize edits go back as `PATCH /sessions/:id` diffs.
A client of the `@zenflow/shared` contract alongside [`mobile/`](../mobile/README.md). Part of the [Zenflow monorepo](../README.md).

## Run

```bash
# From repo root, once:
pnpm install && pnpm shared:build && pnpm core:build

# Inside frontend/, or `pnpm --filter frontend <script>`:
pnpm dev            # builds @zenflow/core, then Vite at http://localhost:5173
pnpm build          # tsc -b && vite build
pnpm typecheck      # tsc -b --noEmit
pnpm lint           # eslint .
pnpm test:e2e       # Playwright (Chromium)
pnpm test:e2e:ui    # Playwright UI mode
```

| Env var         | Used by                | Notes                                                                   |
| --------------- | ---------------------- | ----------------------------------------------------------------------- |
| `VITE_API_URL`  | app, Playwright        | API base, e.g. `http://localhost:5000/api/v1`                           |
| `MAILHOG_URL`   | Playwright             | Default `http://localhost:8025`; e2e logs in by reading the OTP from it |
| `E2E_BASE_URL`  | Playwright             | Default `http://localhost:5173`                                         |
| `E2E_NO_SERVER` | Playwright             | Set to skip starting `pnpm dev`                                         |

- e2e specs live in `e2e/` ([`playwright.config.ts`](playwright.config.ts)); none are checked in yet.
- e2e needs the backend stack (Postgres, Redis, MailHog) up: see [backend/README.md](../backend/README.md).

## Stack

| Concern           | Choice                                                                  |
| ----------------- | ----------------------------------------------------------------------- |
| Framework / build | React 19, Vite 6, `vite-plugin-pwa` (auto-update service worker)        |
| Language          | TypeScript 5.7 strict, `@/*` -> `src/*`                                 |
| Styling           | Tailwind CSS v4 (`@tailwindcss/vite`), OKLch tokens, glassmorphism      |
| UI                | Radix UI + `class-variance-authority`, `lucide-react`, Geist font       |
| State             | Zustand user store + component state                                    |
| Routing / forms   | React Router 7; React Hook Form + Zod                                   |
| Drag and resize   | `@dnd-kit/core` + `@dnd-kit/modifiers`                                  |
| Rich text         | TipTap (note editor with file uploads)                                  |
| Dates             | `date-fns`, `date-fns-tz`, `rrule`                                      |
| HTTP              | axios (credentials) with envelope + DTO types from `@zenflow/shared`    |
| Toasts            | Sonner                                                                  |

## Layout

```
frontend/
├── src/
│   ├── api/            # axios client (base.ts) + typed endpoint fns per resource
│   ├── components/     # auth, calendar, tasks (+ form/), notifications, settings,
│   │                   #   common (TipTap editor), ui (Radix primitives), hoc/with-auth
│   ├── hooks/          # use-user-store, use-task-form, use-view-shortcuts, ...
│   ├── lib/            # utils.ts (cn()), toast.tsx (errorToast)
│   ├── pages/          # home, login, not-found
│   ├── types/          # re-exports of @zenflow/shared shapes
│   ├── utils/          # tz.ts, time.ts, snap.ts, editing.ts, navigation.ts, ...
│   └── App.tsx / main.tsx / index.css
├── e2e/                # Playwright specs + helpers
├── vite.config.ts      # react + tailwind + pwa plugins, @ alias
└── playwright.config.ts
```

`@zenflow/core` ([`packages/core/src/`](../packages/core/src)) is the logic shared with mobile:

- `blocks.ts`, `overlap.ts`, `task-card.ts` (`deriveState`, `withOverlap`, `TASK_CARD_CLASSES`)
- `tasks.ts` (`sessionSchema`, `getSeriesKind`, `placementQualifier`), `recurrence.ts`
- `session-count.ts`, `session-time.ts`, `session-type.ts`, `reminders.ts`, `location.ts`
- `tz.ts`, `time.ts`, `constants.ts`

Screens, session form, calendar, notifications and toasts: [docs/frontend/screens.md](../docs/frontend/screens.md).

## Conventions

- **Timezone**: the calendar reasons in the user's IANA timezone, never the browser's.
  - Every calendar `Date` carries user-tz wall clock in its local fields, so `date-fns` works in user-tz space.
  - `zonedNow(tz)`, `zonedDate(iso, tz)` (UTC to wall clock), `zonedWallClockToUtc(wallClock, tz)` in `src/utils/tz.ts`.
  - Call `zonedWallClockToUtc` before sending to the API. No bare `new Date()` in day/grid logic.
- **API layer** (`src/api/`) is the only place axios is called; endpoint fns return typed `@zenflow/shared` shapes.
- **State**: the Zustand user store (`hooks/use-user-store.ts`), hydrated by the auth gate. Everything else is component state.
- **UI**: build from `components/ui/` primitives before adding dependencies. Compose classes with `cn()` and CVA.
- **Errors**: surface through Sonner toasts (`errorToast` in `lib/toast.tsx`).
- **Naming**: files kebab-case, components PascalCase, props camelCase.
- **Desktop only**: no mobile breakpoints unless asked.
- Repo-wide rules: [AGENTS.md](../AGENTS.md).

### Design system: Warm Sunrise

- Taupe base + Amber accent as OKLch tokens in `src/index.css` (`:root` and `.dark`); brand ramp orange, yellow, lime.
- Glass utilities: `.glass-task`, `.glass-header`, `.glass-panel`, `.glass-notice` (backdrop blur).
- Dark mode via `next-themes`: full token inversion, visible borders.

## Contributing

- ESLint with 2-space indent ([`.editorconfig`](../.editorconfig)); use the `@/...` alias (`no-relative-import-paths` autofixes).
- [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/), e.g. `feat(calendar): ...`.
- Setup, branching, testing: [CONTRIBUTING.md](../CONTRIBUTING.md).
