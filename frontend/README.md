# Zenflow Web (frontend)

React 19 + Vite PWA — the desktop calendar client. Users create sessions, and the backend
places flexible tasks into open slots; drag, resize and Optimize-free direct edits go back
as plain `PATCH /sessions/:id` diffs. An active client of the `@zenflow/shared` contract
alongside [`mobile/`](../mobile/README.md). Part of the
[Zenflow monorepo](../README.md).

---

## Tech stack

| Concern           | Choice                                                                    |
| ----------------- | ------------------------------------------------------------------------- |
| Framework / build | React 19, Vite 6, `vite-plugin-pwa` (auto-update service worker)          |
| Language          | TypeScript 5.7 (strict, `@/*` → `src/*`)                                  |
| Styling           | Tailwind CSS v4 (`@tailwindcss/vite`), OKLch design tokens, glassmorphism |
| UI primitives     | Radix UI + `class-variance-authority`, `lucide-react` icons, Geist font   |
| State             | Zustand (global user store) + component state                            |
| Routing           | React Router 7                                                            |
| Forms             | React Hook Form + Zod (`@hookform/resolvers`)                             |
| Drag & resize     | `@dnd-kit/core` + `@dnd-kit/modifiers`                                    |
| Rich text         | TipTap (`note` editor with file uploads)                                  |
| Dates             | `date-fns` + `date-fns-tz`, `rrule`                                       |
| HTTP              | axios (with credentials), envelope + DTO types from `@zenflow/shared`     |
| Shared logic      | `@zenflow/core` — calendar blocks, overlap layout, the session form schema |
| Notifications     | Sonner toasts                                                             |
| Tests             | Playwright (e2e, Chromium)                                                |

## Folder structure

```
frontend/
├── src/
│   ├── api/                   # axios client + typed endpoint fns
│   │   ├── base.ts            # axios instance (VITE_API_URL, withCredentials)
│   │   ├── index.ts           # fetch helpers (file upload/remove)
│   │   ├── auth.ts  tasks.ts  users.ts  tags.ts  files.ts
│   │   ├── integrations.ts    # LMS / student-portal connect + sync
│   │   └── notifications.ts   # the ingestion inbox
│   ├── components/
│   │   ├── auth/              # login-form
│   │   ├── calendar/          # day/week/month views + grid + blocks + header
│   │   │   ├── update-recurring-dialog.tsx  # scope picker for a series drag/resize
│   │   │   └── session-type-badge.tsx
│   │   ├── tasks/             # create/edit dialogs, delete-recurring-dialog
│   │   │   └── form/          # task-form + title / deadline-chip / tag /
│   │   │                      #   session-type-tabs / recurrence / fixed-time /
│   │   │                      #   session-count fields
│   │   ├── notifications/     # notification-bell (header inbox popover)
│   │   ├── settings/          # settings-dialog + preferences (heatmap) + integrations
│   │   ├── common/            # date-range-select, TipTap editor + toolbar
│   │   ├── ui/                # Radix + Tailwind primitives
│   │   └── hoc/with-auth.tsx  # auth gate (no onboarding step)
│   ├── hooks/                 # use-user-store, use-task-form, use-view-shortcuts, …
│   ├── lib/                   # utils.ts (cn()), toast.ts (errorToast)
│   ├── pages/                 # home, login, not-found
│   ├── types/                 # re-exports of @zenflow/shared shapes
│   ├── utils/                 # tz.ts, time.ts, snap.ts, editing.ts, navigation.ts, …
│   ├── App.tsx / main.tsx / index.css
├── e2e/                       # Playwright specs + helpers (OTP via MailHog)
├── vite.config.ts            # react + tailwind + pwa plugins, @ alias
└── playwright.config.ts
```

`@zenflow/core` (`packages/core/src/`) is the FE/mobile-shared logic layer: `blocks.ts`
(`taskToBlock` / `eventsForDay`), `overlap.ts` (`getOverlapLayout`), `task-card.ts`
(`deriveState` / `withOverlap` / `TASK_CARD_CLASSES`), `tasks.ts` (`sessionSchema`,
`getSeriesKind`, `placementQualifier`), `recurrence.ts` (`fromRrule` / `toRrule`),
`session-count.ts`, `session-time.ts` (`combineToUtc` / `splitZoned`), `session-type.ts`
(`SESSION_TYPE_META`), and `tz.ts` / `time.ts` / `constants.ts`. The web app keeps its own
`src/utils/tz.ts` for the browser-specific wall-clock handling.

## Screens & routing

| Route    | Page                  | Notes                                  |
| -------- | --------------------- | -------------------------------------- |
| `/`      | `pages/home.tsx`      | the calendar; gated by `with-auth.tsx` |
| `/login` | `pages/login.tsx`     | email → OTP verification               |
| `*`      | `pages/not-found.tsx` | 404                                    |

There is **no onboarding step** — a fresh signup lands in the app directly; timezone is
captured once at OTP signup (`x-timezone` header) and isn't user-editable after. The
**auth gate** (`components/hoc/with-auth.tsx`) calls `me()` on mount and redirects to
`/login?callback=…` when unauthenticated.

**Settings** is a dialog (`components/settings/settings-dialog.tsx`), opened from the
sidebar footer via a `zenflow:open-settings` window event. Three tabs:
- **Insights** — the 7×24 signed preference heatmap from `GET /users/me/preference-matrix`,
  with a cold-start empty state.
- **Integrations** — connect / sync / disconnect the DLU **LMS** and **student portal**
  accounts (`components/settings/integrations.tsx`). Shows connection + last-sync status;
  credentials are sent once and never returned.
- **Account** — signed-in identity, read-only timezone, Log out.

## Sessions

`SessionType` = `TASK | ASSIGNMENT | EXAM | LECTURE | DND`. The create dialog
(`components/tasks/create-task-dialog.tsx` → `form/task-form.tsx`) opens with a
**3-tab type selector** (`form/session-type-tabs.tsx`): **Task** / **Fixed**
(Assignment · Exam · Lecture) / **Do Not Disturb**.

| Field | Types | Notes |
| --- | --- | --- |
| Title | all | combobox in create mode — `GET /sessions/suggestions` autocompletes duration / tags / note / a forward-shifted deadline |
| Location | all | free text (room / building / link), optional |
| Description | all | TipTap rich text with file uploads |
| Tags | all | name array; unknown names are upserted server-side |
| Duration + Sessions | `TASK`, create only | `form/session-count-field.tsx` — `Sessions > 1` requests a multi-sitting series spread across `now … deadline` |
| Deadline | `TASK` | quick-action chips (`form/deadline-chip-field.tsx`) — Today / Tomorrow / This week / Next week / This month / No rush / Custom, prefetched from `GET /sessions/deadline-options` |
| When | fixed / DND | `form/fixed-time-field.tsx` — date + start/end time; the client derives `durationMinutes` + `scheduledStartTime` |
| Repeat | fixed / DND | `form/recurrence-field.tsx` — Once / Daily / Weekly + weekday set + optional end date → a bare `rrule` |

**Edit** (`edit-task-dialog.tsx`) shows `type` read-only. A `TASK` edits its deadline (and
metadata); a fixed/DND session edits its date/time and recurrence. **Delete** on a session
that belongs to a series opens `delete-recurring-dialog.tsx` (this occurrence / this and
following / whole series); a one-off deletes immediately.

There is **no completion lifecycle** (no "Mark done", no `status`) and **no manual
Optimize** — the backend removed both (see [ADR-0002](../docs/adr/0002-scheduling-simplification.md)).
Scheduling is server-side: `POST /sessions` places a `TASK` into its single best free slot,
and every later edit is a plain `PATCH /sessions/:id` field diff.

## Calendar

`components/calendar/` — `layout.tsx` orchestrates state, fetching and dialogs;
`header.tsx` has date navigation, the day/week/month picker, the notification bell, and the
create trigger; `sidebar.tsx` is the agenda list. `day-view` / `week-view` / `month-view`
(+ their grid/cell children) render the time grids; `scheduled-block-item.tsx` is a single
draggable/resizable block with a click popover.

- **Per-type rendering.** Block colour and the agenda row treatment come from
  `deriveState` + `SESSION_TYPE_META` (`@zenflow/core`): `TASK` = amber, `ASSIGNMENT` =
  teal, `EXAM` = rose, `LECTURE` = sky, `DND` = dashed slate. Non-`TASK` blocks carry a
  `SessionTypeBadge`; a `location` shows with a pin icon.
- **Drag / resize.** dnd-kit drag (day = re-time; week = re-time + re-day; month = re-day)
  and pointer-driven edge-resize both write `PATCH /sessions/:id`. When the dragged block
  belongs to a series, `update-recurring-dialog.tsx` first asks which occurrences the change
  applies to (`scope` + `skipConflicting`).
- **Conflicts.** `@zenflow/core`'s `getOverlapLayout` lays overlapping blocks side by side
  and flags a genuine same-time overlap; `withOverlap` folds it into the card's `conflict`
  state. There is no backend conflict flag.
- **No work-hours shading** — the scheduler places across the full 24 h grid every day.

## Notifications

`components/notifications/notification-bell.tsx` — a header bell with an unread-count badge
that opens a popover listing the DLU watchers' notifications (`GET /notifications`,
polled). Opening it marks the shown rows read (`PATCH /notifications/:id/read`); a row that
points at a session opens it and stamps `action-taken`. Each row shows the calendar type's
icon/tint, a `kind` badge (New / Change / Drop), a spelled-out relative time and, for an
assignment/exam/lecture, its `eventEndsAt` as a `due`/clock label. Unread rows get a red
dot + bold meta; a `NEW` row also gets a red alert mark. The hover ✕ dismisses
(`DELETE /notifications/:id`) — the web counterpart of mobile's swipe.

## Timezone model (important)

`src/utils/tz.ts` — **the calendar reasons entirely in the user's IANA timezone, never the
browser's.** Every calendar `Date` carries the user-tz wall clock in its local fields, so
`date-fns` operations work in user-tz space.

- `zonedNow(tz)` — now, as user-tz wall clock.
- `zonedDate(iso, tz)` — a UTC instant → user-tz wall clock.
- `zonedWallClockToUtc(wallClock, tz)` — the inverse; **call this before sending to the API.**

> Never mix a raw `new Date()` into day/grid logic — always go through `tz.ts`.

## Design system — "Warm Sunrise"

- **Palette:** Taupe base + Amber accent, defined as **OKLch** tokens in `src/index.css`
  (`:root` and `.dark`). Brand ramp orange → yellow → lime.
- **Glassmorphism:** `.glass-task`, `.glass-header`, `.glass-panel` (backdrop blur).
- **Dark mode:** full token inversion (`next-themes`); visible borders in dark.
- **Composition:** `cn()` (clsx + tailwind-merge) and CVA variants.
- **No mobile-responsive target** — this is a desktop calendar; don't add breakpoints
  unless asked.

## Conventions

- **Files** kebab-case; **components** PascalCase; **props** camelCase.
- **API layer** is the only place axios is called; endpoint fns return typed
  `@zenflow/shared` shapes. Surface errors via Sonner toasts.
- **Global state** is the Zustand user store (`hooks/use-user-store.ts`), hydrated by the
  auth gate; everything else is local/component state.
- Build new UI from `components/ui/` primitives before adding dependencies.

## Local development

```bash
# From repo root, once:
pnpm install && pnpm shared:build && pnpm core:build

# Frontend scripts (inside frontend/, or `pnpm --filter frontend <script>`):
pnpm dev            # Vite dev server → http://localhost:5173
pnpm build          # tsc -b && vite build
pnpm typecheck      # tsc -b --noEmit
pnpm lint           # eslint .
pnpm test:e2e       # Playwright (needs the backend stack + MailHog running)
pnpm test:e2e:ui    # Playwright UI mode
```

Set `VITE_API_URL` (e.g. `http://localhost:5000/api/v1`) so the axios client targets the
API. Playwright e2e (`e2e/`) logs in by reading the OTP out of MailHog — bring up the
backend stack first (see [backend/README.md](../backend/README.md)).

## Contributing

- **Formatter / linter:** ESLint (`pnpm --filter frontend lint`). **2-space** indentation
  ([`.editorconfig`](../.editorconfig)). Use the `@/…` import alias instead of deep relative
  paths (`eslint-plugin-no-relative-import-paths` autofixes this).
- **Commits:** [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/),
  e.g. `feat(calendar): …`, `fix(frontend): …`.

See the repo-wide **[CONTRIBUTING.md](../CONTRIBUTING.md)** for setup, branching, and testing.
