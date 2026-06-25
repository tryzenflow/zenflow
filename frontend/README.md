# Zenflow Web (frontend)

React 19 + Vite PWA — the calendar UI where users create tasks and the EDF engine's
placements are rendered, dragged, and resized. Part of the
[Zenflow monorepo](../README.md).

---

## Tech stack

| Concern | Choice |
|---------|--------|
| Framework / build | React 19, Vite 6, `vite-plugin-pwa` (auto-update service worker) |
| Language | TypeScript 5.7 (strict, `@/*` → `src/*`) |
| Styling | Tailwind CSS v4 (`@tailwindcss/vite`), OKLch design tokens, glassmorphism |
| UI primitives | Radix UI + `class-variance-authority`, `lucide-react` icons, Geist font |
| State | Zustand (global user store) + component state |
| Routing | React Router 7 |
| Forms | React Hook Form + Zod (`@hookform/resolvers`) |
| Drag & resize | `@dnd-kit/core` + `@dnd-kit/modifiers` |
| Rich text | TipTap (`note` editor with file uploads) |
| Dates | `date-fns` + `date-fns-tz`, `rrule` |
| HTTP | axios (with credentials), shared envelope types from `@zenflow/shared` |
| Notifications | Sonner toasts |
| Tests | Playwright (e2e, Chromium) |

## Folder structure

```
frontend/
├── src/
│   ├── api/                   # axios client + typed endpoint fns
│   │   ├── base.ts            # axios instance (VITE_API_URL, withCredentials)
│   │   ├── index.ts           # get/post/patch/put/delete helpers
│   │   ├── auth.ts  tasks.ts  users.ts
│   ├── components/
│   │   ├── auth/              # login-form
│   │   ├── calendar/          # day/week/month views + grid + blocks (see below)
│   │   ├── tasks/             # create/edit dialogs, task-form, rrule-form, note-editor
│   │   ├── settings/          # settings-dialog + preferences-fields (shared with onboarding)
│   │   ├── common/            # date-range-select, TipTap editor + toolbar
│   │   ├── ui/                # Radix + Tailwind primitives (button, dialog, select, …)
│   │   ├── hoc/with-auth.tsx  # auth gate + onboarding redirect
│   │   └── logo.tsx
│   ├── hooks/                 # use-user-store, use-view-shortcuts, use-drag-sensors, …
│   ├── lib/                   # utils.ts (cn()), task-card.ts (TASK_CARD_CLASSES)
│   ├── pages/                 # home, login, onboarding, not-found
│   ├── types/                 # schedule.ts (Event), tasks.ts, user.ts, date.ts, files.ts
│   ├── utils/                 # tz.ts, time.ts, blocks.ts, overlap.ts, zones.ts, snap.ts, …
│   ├── App.tsx                # router
│   ├── index.css / App.css    # Tailwind import + OKLch tokens + glass/grid styles
│   └── main.tsx
├── e2e/                       # Playwright specs + helpers (OTP via MailHog)
├── public/                    # logo.svg, manifest assets
├── vite.config.ts            # react + tailwind + pwa plugins, @ alias
└── playwright.config.ts
```

## Screens & routing

Routes (`src/App.tsx`):

| Route | Page | Notes |
|-------|------|-------|
| `/` | `pages/home.tsx` | the calendar; gated by `with-auth.tsx` |
| `/login` | `pages/login.tsx` | email → OTP verification |
| `/onboarding` | `pages/onboarding.tsx` | multi-step wizard (work hours / days / role) |
| `*` | `pages/not-found.tsx` | 404 |

The **auth gate** (`components/hoc/with-auth.tsx`) calls `me()` on mount, redirects to
`/login?callback=…` when unauthenticated, and to `/onboarding` when
`user.onboardingComplete === false`.

The **calendar** (`components/calendar/`): `layout.tsx` orchestrates state, data fetching,
and dialogs; `header.tsx` has date navigation + the day/week/month view picker (keyboard
shortcuts via `use-view-shortcuts`: D/W/M switch view, ←/→ step to the previous/next period
at the active view's granularity — all suppressed while typing in a field, see
`utils/editing.ts`; the prev/next step logic is shared with the header buttons in
`utils/navigation.ts`); `sidebar.tsx` is the agenda list; `day-view`,
`week-view`, `month-view` (+ their `*-grid` / `*-cell` children) render the time grids;
`scheduled-block-item.tsx` is a single draggable/resizable task block with a click popover.
Task create/edit lives in `components/tasks/` (`create-task-dialog`, `edit-task-dialog`,
`form/task-form`, `rrule-form`, `note-editor`). In **create** mode the "Task name" field is
a combobox (`TitleField` in `form/task-form.tsx`): typing fetches the user's existing tasks
(`GET /tasks/suggestions`, debounced ~250ms, server-ordered by recency) and picking one
autocompletes the rest of the form — duration, scheduling type, tags, note, and a
forward-shifted deadline (the source task's create→deadline lead time re-applied from now,
split into date/time in the user's tz). Edit mode keeps the plain input.

**Settings** is a dialog, not a route: `components/settings/settings-dialog.tsx` is a
Todoist-style **tabbed** dialog — **Work** (hours / days / role archetype / timezone via
`updatePreferences`), **Scheduling** (the Phase-2 `auto | ask | never` duration-adjustment
mode, `components/settings/duration-mode-field.tsx`), **Insights** (`UserPreferencesPanel`
in `components/settings/preferences.tsx`, two sections: the 7×24 signed preference heatmap
fetched from `GET /users/me/preference-matrix` and per-tag learned duration multipliers
fetched from `GET /users/me/tag-bias`, both with cold-start empty states), and **Account**
(the Log out action). It's mounted once in `layout.tsx`; the sidebar footer (`sidebar.tsx`) shows the
signed-in user and opens it via a `zenflow:open-settings` window event (same pattern as
`zenflow:open-task`). The work-field inputs and constants are shared with onboarding through
`components/settings/preferences-fields.tsx`; the duration-mode control is shared via
`duration-mode-field.tsx`.

**Onboarding** (`pages/onboarding.tsx`) is a wizard whose steps are Welcome · Work Hours ·
Work Days · Your Role · **Adjustments** (the same `auto | ask | never` control) · All Set;
the chosen mode is wired into `OnboardingInput.durationAdjustmentMode`.

**Phase-2 transparency UI (issue #13).** Scheduling decisions are surfaced as sonner
`toast.custom` bodies that mirror `overflow-toast.tsx`: `tasks/rationale-toast.tsx` (why a
task was placed, from `RescheduleResponse.rationale`) and the duration-adjustment toasts in
`lib/scheduling-toasts.tsx` (`auto` → apply + **Undo**; `ask` → blocking Accept/Keep; both
revert via `PATCH /tasks/:id/resize`). The rationale toast is shown from `layout.tsx`
(reschedule/resize) and `create-task-dialog.tsx` (resolve-overflow); the duration toast from
`create-task-dialog.tsx` off the create response's `schedulingMeta`. While a block is being
edge-resized, `scheduled-block-item.tsx` renders the added/removed minutes as a distinct
delta band/label (purely visual, driven off the existing resize-preview state so it doesn't
touch the drag/resize gesture path). The Phase-2 `@zenflow/shared` type deltas are consumed
through `src/types/phase2.ts` — a temporary shim that mirrors the ADR shapes until the
backend ships them in `@zenflow/shared` (see the file header for the one-line migration).

## Calendar internals

- **Positioning:** a task block's top/height come from its minutes-of-day mapped onto the
  grid (`HOUR_PX`/`DAY_PX` in `utils/zones.ts`, `DAILY_HORIZON` = 1440). See
  `utils/blocks.ts` (`taskToBlock`) and `types/schedule.ts`.
- **Drag → reschedule:** dnd-kit (`useDraggable` + `DndContext`, sensors from
  `use-drag-sensors`). Dropping a block calls `rescheduleTask` → `PATCH /tasks/:id/reschedule`.
  Day view restricts dragging to the vertical axis (re-time only); week view drags freely in
  2D (cell ids encode `hour:minute:dayIndex`, so a horizontal drop also re-days the task);
  month view drags freely across day cells (re-day only, time-of-day preserved).
- **Edge resize:** top/bottom handles capture the pointer, preview locally, then call
  `resizeTask` → `PATCH /tasks/:id/resize`. Both snap to the 15-min grid (`utils/snap.ts`).
- **Overlaps:** `utils/overlap.ts` (`getOverlapLayout`) greedily lays overlapping blocks
  side-by-side (column/columns). Conflicts get the amber `conflict` card state.
- **Work zones:** `utils/zones.ts` (`getDayZones`) returns the work-hour `segments` (px) for
  a column and tints their complement as non-work / weekend; day & week views draw a "now"
  indicator. Overnight (cross-midnight) windows — `workEnd <= workStart` — anchor to the start
  day and render two bands: an evening segment on the workday plus a morning spill-over on the
  next column. Time pickers + wrap-aware validation live in
  `components/settings/preferences-fields.tsx` (`isValidWindow` / `workWindowMinutes` /
  `windowWraps`).
- **Recurrence:** the backend materializes a series into individual rows (shared `seriesId`);
  the frontend just renders the flat `Task[]` for the current view window. Mutations pass a
  `scope` of `"one"` or `"following"`.

## Timezone model (important)

`src/utils/tz.ts` — **the calendar reasons entirely in the user's IANA timezone, never the
browser's.** Every calendar `Date` carries the user-tz *wall clock* in its local fields, so
`date-fns` operations (`isSameDay`, `addDays`, `format`, …) work in user-tz space.

- `zonedNow(tz)` — now, as user-tz wall clock.
- `zonedDate(iso, tz)` — a UTC instant → user-tz wall clock.
- `zonedWallClockToUtc(wallClock, tz)` — the inverse; **call this before sending to the API.**
- `isZonedToday`, `tzAbbrev` — helpers.

> Never mix a raw `new Date()` into day/grid logic — always go through `tz.ts`. This is the
> single easiest thing to get subtly wrong in this codebase.

## Design system — "Warm Sunrise"

- **Palette:** Taupe base + Amber accent, defined as **OKLch** tokens in `src/index.css`
  (`:root` and `.dark`) and `src/App.css`. Brand ramp orange → yellow → lime.
- **Glassmorphism:** `.glass-task`, `.glass-header`, `.glass-panel` (backdrop blur).
- **Dark mode:** full token inversion (`next-themes`); dark mode uses visible borders.
- **Composition:** `cn()` (`lib/utils.ts`, clsx + tailwind-merge) and CVA variants. Task
  card visual states (`fluid`, `fixed`, `overdue`, `conflict`, `completed`) come from
  `lib/task-card.ts` (`TASK_CARD_CLASSES`).
- **No mobile-responsive target** — this is a desktop calendar; don't add breakpoints
  unless asked.

## Conventions

- **Files** kebab-case (`scheduled-block-item.tsx`, `use-view-shortcuts.ts`);
  **components** PascalCase; **props** camelCase.
- Functional components + hooks; extract complex logic into `hooks/`.
- **API layer** is the only place axios is called; endpoint fns return typed
  `@zenflow/shared` shapes. Surface errors via Sonner toasts.
- **Global state** is the Zustand user store (`hooks/use-user-store.ts`), hydrated by the
  auth gate; everything else is local/component state.
- Build new UI from `components/ui/` primitives before reaching for new dependencies.

## Local development

```bash
# From repo root, once:
pnpm install && pnpm shared:build

# Frontend scripts (inside frontend/, or `pnpm --filter frontend <script>`):
pnpm dev            # Vite dev server → http://localhost:5173
pnpm build          # tsc -b && vite build
pnpm typecheck      # tsc -b --noEmit
pnpm lint           # eslint .
pnpm test:e2e       # Playwright (needs the backend stack + MailHog running)
pnpm test:e2e:ui    # Playwright UI mode
```

Set `VITE_API_URL` (e.g. `http://localhost:5000`) so the axios client targets the API.
Playwright e2e (`e2e/`) logs in by reading the OTP out of MailHog — bring up the backend
stack first (see [backend/README.md](../backend/README.md)).

## Contributing

- **Formatter / linter:** ESLint (`pnpm --filter frontend lint`). **2-space** indentation
  ([`.editorconfig`](../.editorconfig)). Use the `@/…` import alias instead of deep relative
  paths — `eslint-plugin-no-relative-import-paths` autofixes this (same-folder `./x` stays
  relative).
- **Commits:** [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/),
  e.g. `feat(calendar): …`, `fix(frontend): …`, `style(ui): …`.

See the repo-wide **[CONTRIBUTING.md](../CONTRIBUTING.md)** for setup, branching, and testing.
