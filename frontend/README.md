# Zenflow Web (frontend)

React 19 + Vite PWA — the calendar UI where users create sessions and place them by hand
(drag/resize/Optimize). There is no auto-placement engine — the old EDF scheduler was
dropped; see "No auto-placement engine" below. Part of the
[Zenflow monorepo](../README.md).

---

## Tech stack

| Concern           | Choice                                                                    |
| ----------------- | ------------------------------------------------------------------------- |
| Framework / build | React 19, Vite 6, `vite-plugin-pwa` (auto-update service worker)          |
| Language          | TypeScript 5.7 (strict, `@/*` → `src/*`)                                  |
| Styling           | Tailwind CSS v4 (`@tailwindcss/vite`), OKLch design tokens, glassmorphism |
| UI primitives     | Radix UI + `class-variance-authority`, `lucide-react` icons, Geist font   |
| State             | Zustand (global user store) + component state                             |
| Routing           | React Router 7                                                            |
| Forms             | React Hook Form + Zod (`@hookform/resolvers`)                             |
| Drag & resize     | `@dnd-kit/core` + `@dnd-kit/modifiers`                                    |
| Rich text         | TipTap (`note` editor with file uploads)                                  |
| Dates             | `date-fns` + `date-fns-tz`, `rrule`                                       |
| HTTP              | axios (with credentials), shared envelope types from `@zenflow/shared`    |
| Notifications     | Sonner toasts                                                             |
| Tests             | Playwright (e2e, Chromium)                                                |

## Folder structure

```
frontend/
├── src/
│   ├── api/                   # axios client + typed endpoint fns
│   │   ├── base.ts            # axios instance (VITE_API_URL, withCredentials)
│   │   ├── index.ts           # get/post/patch/put/delete helpers
│   │   ├── auth.ts  tasks.ts  users.ts  scheduler.ts
│   ├── components/
│   │   ├── auth/              # login-form
│   │   ├── calendar/          # day/week/month views + grid + blocks (see below)
│   │   ├── tasks/             # create/edit dialogs, task-form, note-editor, duration-input
│   │   ├── settings/          # settings-dialog (Insights · Account) + preferences (heatmap)
│   │   ├── common/            # date-range-select, TipTap editor + toolbar
│   │   ├── ui/                # Radix + Tailwind primitives (button, dialog, select, …)
│   │   ├── hoc/with-auth.tsx  # auth gate (no onboarding step, see below)
│   │   └── logo.tsx
│   ├── hooks/                 # use-user-store, use-view-shortcuts, use-drag-sensors, …
│   ├── lib/                   # utils.ts (cn()), toast.ts (errorToast)
│   ├── pages/                 # home, login, not-found
│   ├── types/                 # tasks.ts, user.ts, date.ts, files.ts
│   ├── utils/                 # tz.ts, time.ts, snap.ts, tasks.ts (re-exports @zenflow/core), …
│   ├── App.tsx                # router
│   ├── index.css / App.css    # Tailwind import + OKLch tokens + glass/grid styles
│   └── main.tsx
├── e2e/                       # Playwright specs + helpers (OTP via MailHog)
├── public/                    # logo.svg, manifest assets
├── vite.config.ts            # react + tailwind + pwa plugins, @ alias
└── playwright.config.ts
```

`@zenflow/core` (`packages/core/src/`) is the FE/mobile-shared logic layer: `blocks.ts`
(`taskToBlock`/`tasksToBlocks`/`eventsForDay`), `overlap.ts` (`getOverlapLayout`), `task-card.ts`
(`deriveState`/`withOverlap`/`TASK_CARD_CLASSES`), `tasks.ts` (`sessionSchema`/`SessionFormValues`/
`placementQualifier`), `tz.ts`/`time.ts`/`constants.ts`. The frontend used to keep local forks of
several of these under `src/utils/` — they're gone now in favor of the shared package; only the
genuinely web-specific timezone/snap/editing helpers remain in `src/utils/`.

## Screens & routing

Routes (`src/App.tsx`):

| Route    | Page                  | Notes                                   |
| -------- | --------------------- | ---------------------------------------- |
| `/`      | `pages/home.tsx`      | the calendar; gated by `with-auth.tsx`   |
| `/login` | `pages/login.tsx`     | email → OTP verification                 |
| `*`      | `pages/not-found.tsx` | 404                                      |

**There is no onboarding step.** A fresh signup lands in the app directly — timezone is
captured once at OTP signup via the `x-timezone` header (`api/auth.ts`) and isn't
user-editable after that; `workStart`/`workEnd`/`workDays`/`onboardingComplete` were dropped
from `User` with no replacement (education-pivot migration; see `@zenflow/shared`'s
`user.ts`), so there's nothing left for an onboarding wizard to collect. `pages/onboarding.tsx`
and its route were deleted; mirrors `mobile/app/_layout.tsx`'s `AuthGate`. The **auth gate**
(`components/hoc/with-auth.tsx`) just calls `me()` on mount and redirects to
`/login?callback=…` when unauthenticated.

The **calendar** (`components/calendar/`): `layout.tsx` orchestrates state, data fetching,
and dialogs; `header.tsx` has date navigation + the day/week/month view picker + the Optimize
entry point (`optimize-button.tsx`, see below) (keyboard
shortcuts via `use-view-shortcuts`: D/W/M switch view, ←/→ step to the previous/next period
at the active view's granularity — all suppressed while typing in a field, see
`utils/editing.ts`; the prev/next step logic is shared with the header buttons in
`utils/navigation.ts`); `sidebar.tsx` is the agenda list; `day-view`,
`week-view`, `month-view` (+ their `*-grid` / `*-cell` children) render the time grids;
`scheduled-block-item.tsx` is a single draggable/resizable session block with a click popover.
Session create/edit lives in `components/tasks/` (`create-task-dialog`, `edit-task-dialog`,
`form/task-form`, `note-editor`, `duration-input`). In **create** mode the "Session name" field
is a combobox (`TitleField` in `form/title-field.tsx`): typing fetches the user's existing
sessions (`GET /sessions/suggestions`, debounced ~250ms, server-ordered by recency) and picking
one autocompletes the rest of the form — duration, tags, note, and a forward-shifted deadline
(the source session's create→deadline lead time re-applied from now). Edit mode keeps the plain
input and hides the duration field (duration changes happen by resizing the block on the
calendar, not in the form).

**Deadline is required** and is set entirely through quick-action chips
(`components/tasks/form/deadline-chip-field.tsx`) — Today / Tomorrow / This week / Next week
/ This month / No rush / Custom. The six non-custom values are prefetched once per form-open
from `GET /sessions/deadline-options` (`getDeadlineOptions` in `api/tasks.ts`) so every click is
instant; Today/Tomorrow pin the calendar day and let the user fine-tune only the time,
Custom exposes both the existing `DatePicker` and `components/ui/time-picker.tsx` (a
Popover-based hour/minute/AM-PM picker, not the native `<input type="time">`).

**No auto-placement engine — every write is a direct, single-session field diff.** The old EDF
scheduler (tiered placement search, cascades, per-session `rationale`/`conflict`/`manuallyMoved`
flags, session history/event timeline) was deleted outright, not replaced with something
narrower — see `@zenflow/shared`'s `task.ts` doc comment on `UpdateSessionInput`: "one endpoint
(`PATCH /sessions/:id`) covers all of it... each field is a plain diff applied directly." There
is no cascade or displaced-session side effect on any write. Concretely:

- **Create** (`create-task-dialog.tsx`) calls `POST /sessions` with title/duration/deadline/tags/
  note only — the DTO doesn't even accept a `scheduledStartTime`, so a freshly created session is
  always unscheduled. It won't render as a calendar block until it's placed (drag, or Optimize).
- **Edit** (`edit-task-dialog.tsx`) calls `PATCH /sessions/:id` with whatever metadata changed.
  No confirm-before-reschedule prompt, no rationale toast — notes.md's triggers 1–3 (reschedule
  prompts on create/edit-deadline/delete) are explicitly deferred, not built.
- **Drag / resize / complete** (`layout.tsx`'s `onReschedule`/`onResize`/`onComplete`) all call
  `updateSession(id, { scheduledStartTime, durationMinutes, status })` directly — no dedicated
  reschedule/resize/complete endpoints.
- **Delete** frees only that session's own slot.

The only client-derived visual state left is **conflict**: `@zenflow/core`'s `withOverlap` folds
a genuine same-time overlap between two live blocks (computed purely client-side from the
rendered layout, `getOverlapLayout`) into the card's state — there is no backend `conflict` flag
anymore.

**Optimize — the one explicit, opt-in, multi-session action.** `components/calendar/
optimize-button.tsx` is a single `Sparkles`-icon header button (`components/calendar/header.tsx`)
— no popover, no mode picker, no preview step (the old 3-mode full/balanced/fixed picker and its
large-batch confirm guard were dropped along with the EDF engine). Clicking it calls
`api/scheduler.ts`'s `optimizeSchedule(now, now + 14 days)` (`POST /scheduler/optimize`), which
applies immediately and returns `{ batchId, diffs }` (`@zenflow/shared`'s `OptimizeResponse`). A
successful run shows a one-line sonner toast — "Optimized N sessions" — with an **Undo** action
wired to `undoOptimize(batchId)` (`POST /scheduler/optimize/undo/:batchId`, unconditional
revert). An empty `diffs` shows "Nothing to optimize" with no Undo action. Mirrors
`mobile/components/calendar/day-timeline.tsx`'s Optimize trigger.

**Settings** is a dialog, not a route: `components/settings/settings-dialog.tsx` is a tabbed
dialog — **Insights** (`UserPreferencesPanel` in `components/settings/preferences.tsx`: the 7×24
signed preference heatmap fetched from `GET /users/me/preference-matrix`, with a cold-start empty
state) and **Account** (signed-in identity, read-only timezone, Log out). There is no "Work" tab
anymore — `workStart`/`workEnd`/`workDays` were dropped from `User` with no replacement, and
timezone is fixed at OTP signup with no update endpoint, so neither is user-editable. It's
mounted once in `layout.tsx`; the sidebar footer (`sidebar.tsx`) shows the signed-in user and
opens it via a `zenflow:open-settings` window event (same pattern as `zenflow:open-task`).

## Calendar internals

- **Positioning:** a session block's top/height come from its minutes-of-day mapped onto the
  grid (`--week-cells-height` CSS var, `DAILY_HORIZON` = 1440). See `@zenflow/core`'s
  `blocks.ts` (`taskToBlock`/`tasksToBlocks`/`eventsForDay`) and `@zenflow/shared`'s
  `schedule.ts` (`Event`/`DaySegment`).
- **Drag → reschedule:** dnd-kit (`useDraggable` + `DndContext`, sensors from
  `use-drag-sensors`). Dropping a block calls `updateSession(id, { scheduledStartTime })` — a
  plain field write, no cascade. Day view restricts dragging to the vertical axis (re-time
  only); week view drags freely in 2D (cell ids encode `hour:minute:dayIndex`, so a horizontal
  drop also re-days the session); month view drags freely across day cells (re-day only,
  time-of-day preserved).
- **Edge resize:** top/bottom handles capture the pointer, preview locally, then call
  `updateSession(id, { scheduledStartTime, durationMinutes })`. Both snap to the 15-min grid
  (`utils/snap.ts`).
- **Overlaps:** `@zenflow/core`'s `getOverlapLayout` greedily lays overlapping blocks
  side-by-side (column/columns) and flags a genuine same-time overlap between two live blocks;
  `withOverlap` folds that into the card's `conflict` state.
- **No work-hours shading.** `day-column-background.tsx`/`month-cell.tsx`/`week-view.tsx` used to
  tint "outside working hours" / weekend zones (`@zenflow/core`'s old `getDayZones`/
  `DEFAULT_WORK_PREFS`) — removed along with the `workStart`/`workEnd`/`workDays` fields on
  `User`. There is no working-hours concept left to shade; day/week views still draw a "now"
  indicator, and month cells still dim adjacent-month days.
- **Recurrence / session series is not implemented yet.** `Session` has no `seriesId` — that's
  future work (see the repo-root `notes.md`), explicitly out of scope for this pass.

## Timezone model (important)

`src/utils/tz.ts` — **the calendar reasons entirely in the user's IANA timezone, never the
browser's.** Every calendar `Date` carries the user-tz _wall clock_ in its local fields, so
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
- **Composition:** `cn()` (`lib/utils.ts`, clsx + tailwind-merge) and CVA variants. Session
  card visual states (`fluid`, `overdue`, `conflict`, `completed` — `@zenflow/shared`'s
  `SessionCardState`) come from `@zenflow/core`'s `task-card.ts` (`deriveState`/`withOverlap`/
  `TASK_CARD_CLASSES`).
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
