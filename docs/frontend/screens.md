# Frontend screens and behaviour

For developers working on `frontend/`. Setup and conventions live in [frontend/README.md](../../frontend/README.md).

## Routing and auth

| Route    | Page                  | Notes                                  |
| -------- | --------------------- | -------------------------------------- |
| `/`      | `pages/home.tsx`      | the calendar; gated by `with-auth.tsx` |
| `/login` | `pages/login.tsx`     | email, then OTP verification           |
| `*`      | `pages/not-found.tsx` | 404                                    |

- No onboarding step: a fresh signup lands in the app.
- Timezone is captured once at OTP signup (`x-timezone` header, `api/auth.ts`) and is not editable.
- `components/hoc/with-auth.tsx` calls `me()` on mount and redirects to `/login?callback=...` when signed out.

## Settings

A dialog (`components/settings/settings-dialog.tsx`) opened from the sidebar footer via the `zenflow:open-settings` window event.

| Tab          | Shows                                                                                              |
| ------------ | -------------------------------------------------------------------------------------------------- |
| Insights     | 7x24 signed preference heatmap from `GET /users/me/preference-matrix`; cold-start empty state     |
| Integrations | Connect, sync, disconnect the DLU LMS and student portal; last-sync status; credentials never returned |
| Account      | Signed-in identity, read-only timezone, Log out                                                    |

## Sessions

`SessionType` = `TASK | ASSIGNMENT | EXAM | LECTURE | DND`.
The create dialog (`create-task-dialog.tsx` -> `form/task-form.tsx`) opens with 3 tabs (`form/session-type-tabs.tsx`): Task, Fixed (Assignment, Exam, Lecture), Do Not Disturb.

| Field               | Types               | Notes                                                                                                  |
| ------------------- | ------------------- | ------------------------------------------------------------------------------------------------------ |
| Title               | all                 | Combobox in create mode; `GET /sessions/suggestions` autocompletes duration, tags, note, shifted deadline |
| Location            | all                 | Optional free text (room, building, link)                                                              |
| Description         | all                 | TipTap rich text with file uploads                                                                     |
| Reminder            | all except `DND`    | `form/reminder-field.tsx`; up to 2 chips, edit in place, x removes; sent as `reminders: number[]` (minutes before start); new tasks default `[60]` |
| Tags                | all                 | Name array; unknown names are upserted server-side                                                     |
| Duration + Sessions | `TASK`, create only | `form/session-count-field.tsx`; `Sessions > 1` requests a series spread over `now ... deadline`        |
| Deadline            | `TASK`              | Chips (`form/deadline-chip-field.tsx`) prefetched from `GET /sessions/deadline-options`: Today, Tomorrow, This week, Next week, This month, No rush, Custom |
| When                | fixed / DND         | `form/fixed-time-field.tsx`; client derives `durationMinutes` + `scheduledStartTime`                   |
| Repeat              | fixed / DND         | `form/recurrence-field.tsx`; Once / Daily / Weekly + weekdays + optional end date -> a bare `rrule`    |

Reminder presets: At start, 15 min, 30 min, 1 hour, 2 hours, 1 day, 2 days, 3 days, 1 week, custom amount + unit.

- **Edit** (`edit-task-dialog.tsx`): `type` is read-only. A `TASK` edits deadline and metadata; fixed/DND edits date, time, recurrence.
- **Delete** in a series opens `delete-recurring-dialog.tsx` (this occurrence, this and following, whole series). A one-off deletes at once.
- No completion lifecycle (no "Mark done", no `status`) and no manual Optimize; see [ADR-0002](../adr/0002-scheduling-simplification.md).
- Scheduling is server-side: `POST /sessions` places a `TASK` in its best free slot; later edits are `PATCH /sessions/:id` field diffs.

### Alternative times

A pairwise-sampled placement returns a second candidate slot. Model identity is never shown.

- **Single `TASK`** create or deadline change with `divergent: true` opens `slot-pick-dialog.tsx` (keep or switch).
- **Series** create or redistribute never blocks; every sitting is already scheduled.
  - If any `sessions[i].divergent` is set, a dismissible toast ("N sittings have an alternative") opens `series-alternatives-dialog.tsx`.
  - It lists up to 5 divergent sittings, soonest first, as primary/alternative radio-card pairs with date and time.
- Picking an alternative calls `POST /sessions/:id/slot-pick` (`chose: "alternative"`), fires `zenflow:calendar-refresh`, and locks the row.
- `409` (now overlaps a sibling) marks the row "No longer available". Closing without picking keeps every sitting as scheduled.

## Calendar

`components/calendar/`:

| File                                 | Role                                                          |
| ------------------------------------ | ------------------------------------------------------------- |
| `layout.tsx`                         | State, fetching, dialogs                                      |
| `header.tsx`                         | Date navigation, view picker, notification bell, create button |
| `sidebar.tsx`                        | Agenda list                                                   |
| `day-view` / `week-view` / `month-view` | Grids (+ grid and cell children)                           |
| `scheduled-block-item.tsx`           | One draggable, resizable block with a click popover           |

- **Per-type colour** (`deriveState` + `SESSION_TYPE_META` from `@zenflow/core`): `TASK` amber, `ASSIGNMENT` teal, `EXAM` rose, `LECTURE` sky, `DND` dashed slate.
  - Non-`TASK` blocks carry `SessionTypeBadge`; a `location` shows with a pin icon.
- **Drag and resize**: dnd-kit drag (day re-times, week re-times and re-days, month re-days) and pointer edge-resize both write `PATCH /sessions/:id`.
  - For a series, `update-recurring-dialog.tsx` first asks the scope (`scope` + `skipConflicting`).
- **Conflicts**: `getOverlapLayout` lays overlaps side by side and flags same-time overlap; `withOverlap` folds it into the `conflict` state. No backend conflict flag.
- **No work-hours shading**: the scheduler uses the full 24 h grid.

## Notifications

`components/notifications/notification-bell.tsx`: header bell with an unread badge, opening a popover of DLU watcher notifications.

- Loads `GET /notifications` and receives new ones over SSE (`GET /notifications/stream`, `withCredentials`), shown as a toast.
- Opening the popover marks shown rows read. Clicking a row that points at a session opens it and stamps `action-taken`.
- Row: type icon and tint, `kind` badge (New, Change, Drop), relative time, and `eventEndsAt` for assignment, exam, lecture.
- Unread = red dot + bold meta; `NEW` also gets a red alert mark.
- Hover x dismisses (`DELETE /notifications/:id`); the web counterpart of mobile's swipe.
- A row action calls `POST /notifications/:id/reschedule-conflicts`.

## Toasts

`components/ui/sonner.tsx`; glass style is `.glass-notice` in `src/index.css`.

- Geist font and a small tinted icon per type.
- iPhone-style collapsed stack: only the newest is fully visible.
- Click the pile to fan it out, click elsewhere to fold it. Hover does nothing (`useClickToExpand` drives sonner's `expand`).
- Every call site passes a short title plus a `description`.
- Use `errorToast(title, { description })` and `apiErrorMessage(error, fallback)` from `lib/toast.tsx`.
