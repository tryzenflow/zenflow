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
autocompletes the rest of the form — duration, tags, note, and a forward-shifted deadline
(the source task's create→deadline lead time re-applied from now). Edit mode keeps the plain
input. There is no "fixed vs flexible" scheduling-type toggle anymore — every task is
flexible; a task only stays put once it's `manuallyMoved` (dragged or resized), rendered as a
lock icon on the block, not a distinct card state.

**Deadline is required** and is set entirely through quick-action chips
(`components/tasks/form/deadline-chip-field.tsx`) — Today / Tomorrow / This week / Next week
/ This month / No rush / Custom (the old date+time inputs and the view-scoped "no deadline"
mode are gone). The six non-custom values are prefetched once per form-open from
`GET /tasks/deadline-options` (`getDeadlineOptions` in `api/tasks.ts`) so every click is
instant; Today/Tomorrow pin the calendar day and let the user fine-tune only the time,
Custom exposes both the existing `DatePicker` and the new `components/ui/time-picker.tsx` (a
Popover-based hour/minute/AM-PM picker — todo.md explicitly rejects the native
`<input type="time">`).

**Create is direct, and always lands somewhere concrete.** Submitting the form calls
`POST /tasks` immediately — no simulate-then-confirm step (the old preview-before-commit
`simulateTask`/`POST /tasks/simulate` is gone; act now, undo if wrong). The pure scheduler
tries in-hours-before-deadline, then outside-hours-before-deadline, then
in-hours-past-deadline before ever giving up, so a create response's `task` always carries a
real placement except the rare last-resort case where `task.conflict` is still true
(genuinely no room anywhere in the scan horizon) — that case shows a `toast.warning` naming
the task instead of a silent no-op. `create-task-dialog.tsx` derives a client-side "why is
this unusual?" signal for the success toast — `utils/tasks.ts`'s
`placementQualifier(task, user)` compares the placement against the deadline and the user's
work window and returns `"onTime"`, `"outsideHours"`, or `"pastDeadline"` (checked in that
priority), appending " — outside your usual work hours" / " — past its deadline" to the toast
copy when relevant (the backend no longer returns *why* a placement is unusual, only where it
landed).

**Auto-resolve, not ask-first — and always visible, always undoable.** A create, a
deadline/tags edit, a drag, or a resize that would leave a task's own slot conflicting with a
neighbour is auto-resolved INLINE by the backend (a same-day repack, same
request/transaction — no confirm toast, no second round-trip). Every one of these calls —
`createTask`, `updateTask`, `removeTask` (delete), `rescheduleTask` (drag), `resizeTask`
(resize) — returns a `displaced: DisplacedTask[]` array of whatever the repack moved, plus an
optional `batchId` grouping the RESCHEDULED events it wrote. `lib/scheduling-toasts.tsx`'s
`maybeShowCascadeToast(response, onUndone)` is a no-op unless both are present; when they are,
it shows `tasks/cascade-toast.tsx` ("N other task(s) moved" + **Undo**, distinct
`ArrowLeftRight` icon so it stacks legibly alongside the rationale and duration-adjustment
toasts) keyed by `cascade:${batchId}` so a literal duplicate fire of the same batch dedupes —
distinct mutations always get a fresh `batchId`, so rapid sequential edits can legitimately
stack several independently-undoable cascade toasts. Undo calls `api/tasks.ts`'s `undoBatch`
(`POST /tasks/reschedule/undo/:batchId`) then the caller's own refetch. All four mutation
sites wire it: `create-task-dialog.tsx`'s `finalizeCreate`, `edit-task-dialog.tsx`'s update
and delete handlers, and `calendar/layout.tsx`'s `onReschedule`/`onResize` (which also now
fire the previously-unused `maybeShowRationaleToast` on the edited task's own response).

**The wide ±3-workday/`[now, deadline]` cascade is gone.** The backend's cost-based scheduler
rewrite dropped the window-scoped "narrow vs. wide" cascade distinction entirely — `reoptimize`
is the one mechanism now, already run inline on every create/update/drag/resize/delete, with
no follow-up action left to offer. `POST /tasks/reschedule-cascade` no longer exists
server-side, so the frontend's `tasks/prompt-reschedule-cascade.ts` (`promptRescheduleCascade`),
`tasks/reschedule-confirm-toast.tsx`, and `tasks/reschedule-choice-toast.tsx` were deleted along
with it, and `utils/tasks.ts`'s `cascadeWindow`/`needsRescheduleWindow`/`hasManualTaskInWindow`
helpers that only fed them. A `task.conflict` that survives the inline reoptimize means a
genuinely saturated calendar (no slot found anywhere in the scan horizon) — there's no
follow-up prompt for it; the task stays flagged `conflict` (surfaced via the amber status dot,
the create-time warning toast above, and the header's `conflictCount` badge — see
`components/calendar/header.tsx`, an amber pill with an `AlertTriangle` icon shown only when
`conflictCount > 0`) until something frees up room. Deleting a task no longer offers a
gap-fill prompt either — any gap it leaves is only filled organically, by a later
create/edit/drag landing on it, and the cascade toast above (`removeTask` now returns
`RemoveTaskResponse { displaced, batchId }` same as the other mutations) tells the user if
that happened immediately.

**Settings** is a dialog, not a route: `components/settings/settings-dialog.tsx` is a
Todoist-style **tabbed** dialog — **Work** (hours / days / timezone via
`updatePreferences`), **Scheduling** (the Phase-2 `auto | ask | never` duration-adjustment
mode via `components/settings/duration-mode-field.tsx`), **Insights** (`UserPreferencesPanel` in
`components/settings/preferences.tsx`, two sections: the 7×24 signed preference heatmap
fetched from `GET /users/me/preference-matrix` and per-tag learned duration multipliers
fetched from `GET /users/me/tag-bias`, both with cold-start empty states), and **Account**
(the Log out action). It's mounted once in `layout.tsx`; the sidebar footer (`sidebar.tsx`) shows the
signed-in user and opens it via a `zenflow:open-settings` window event (same pattern as
`zenflow:open-task`). The work-field inputs and constants are shared with onboarding through
`components/settings/preferences-fields.tsx`; the duration-mode control is shared via
`duration-mode-field.tsx`.

**Onboarding** (`pages/onboarding.tsx`) is a wizard whose steps are Welcome · Work Hours ·
Work Days · **Adjustments** (the same `auto | ask | never` control) · All Set;
the chosen mode is wired into `OnboardingInput.durationAdjustmentMode`.

**Phase-2 transparency UI (issue #13).** Scheduling decisions are surfaced as sonner
`toast.custom` bodies, each a distinct "kind" that stacks independently rather than merging
into one mega-toast: `tasks/rationale-toast.tsx` (why *this* task was placed, from
`RescheduleResponse.rationale` — `lib/scheduling-toasts.tsx`'s `maybeShowRationaleToast`, fired
from `calendar/layout.tsx`'s `onReschedule`/`onResize`), `tasks/cascade-toast.tsx` (did this
ripple to *other* tasks — `maybeShowCascadeToast`, see above), and the duration-adjustment
toasts in `lib/scheduling-toasts.tsx` (`auto` → apply + **Undo**; `ask` → blocking Accept/Keep;
both revert via `PATCH /tasks/:id/resize`). The duration toast is shown from
`create-task-dialog.tsx` off the create response's `schedulingMeta`. While a block is being
edge-resized, `scheduled-block-item.tsx` renders the added/removed minutes as a distinct
delta band/label (purely visual, driven off the existing resize-preview state so it doesn't
touch the drag/resize gesture path). The Phase-2 `@zenflow/shared` type deltas are consumed
through `src/types/phase2.ts` — a thin re-export aggregator, not a shim (every type it
re-exports now ships directly from `@zenflow/shared`).

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
