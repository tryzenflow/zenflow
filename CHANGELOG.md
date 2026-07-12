# Changelog

All notable changes to Zenflow are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0/).

## [2.0.0] — 2026-07-12

Scheduling is now **deadline-first**. Until now a task was scheduled inside the
calendar view the user happened to have open — the same task created from the day
view and the month view could be placed differently, and "fixed" tasks let a user
pin a slot the scheduler then had to work around. Both concepts are gone. A task
now carries a deadline and nothing else, the scheduler owns placement within
`[now, deadline]`, and any edit that would disturb other tasks asks first.

### Changed

- **A deadline is required on every task, and it is entered as a chip.** The task
  form's deadline field is now six quick actions — Today, Tomorrow, This week,
  Next week, This month, No rush — plus Custom. Today/Tomorrow/Custom reveal a time
  input (a new `ui/time-picker`, replacing the raw browser control). The chip values
  come from `GET /tasks/deadline-options`, which derives them from the scheduler's
  own `endOfPeriod` ceiling math, so they respect the night-owl wraparound exactly
  as placement does.

- **Creating a task proposes a slot before it writes anything.** The form calls
  `POST /tasks/simulate` — a read-only dry run of the scheduler — and shows the slot
  it picked in a confirmation toast. The task is only created once the user accepts,
  at which point the schedule is cascaded within the new task's deadline window.

- **Edits that disturb other tasks now ask first.** Changing a deadline, changing
  tags in a way that shifts the corrected duration, or deleting a task prompts with
  three choices: reschedule only auto-scheduled tasks, reschedule everything
  (including manually-moved tasks), or do nothing. Whatever the cascade moves is
  reported back in a "displaced" summary toast. Tasks already in the past or in
  progress never prompt — their placement is history.

- **`POST /tasks/:id/reschedule-cascade` → `POST /tasks/reschedule-cascade`.** The
  cascade is no longer anchored to one task; it takes a window
  (`windowStart`/`windowEnd`) plus an `includeManual` flag, and every non-frozen task
  placed inside that window is eligible to move. It is the single target for all
  three confirm-before-reschedule triggers above.

- **Overflow recovery follows the deadline, not the view.** When no slot exists
  before the deadline, the options offered are the earliest out-of-working-hours slot
  and the earliest in-hours slot searching forward *past* the deadline. The old
  day/week/month "next period" granularity is gone.

- **Task history distinguishes an auto-move from a user move.** A task repositioned
  as collateral in someone else's cascade now records a `RESCHEDULED` event rather
  than `MOVE`, so the preference matrix no longer learns from placements the user
  never chose.

### Removed

- **Fixed (pinned) tasks**, the `schedulingAnchor`, and the per-task `view`. Dropped
  from the schema (`Task.fixed`, `Task.schedulingAnchor`, `Task.view`, the `ViewMode`
  enum), the API (no more `view` / `viewStart` / `viewEnd` on create, reschedule,
  complete, or delete), and the UI (the fixed-task form, the "outside view period"
  after-the-fact prompt).

- **The unused Phase-4 `User.roleArchetypeId`** cold-start cluster field.

- **The offline simulation & evaluation harness** (`backend/src/simulation/`, added in
  1.1.0). It had become a second, divergent copy of the scheduling logic that every
  scheduler change had to be re-taught, while the behaviour it checked is now covered
  by the unit specs and e2e suites. The `sim:*` scripts, `scripts/sim-*.sh`,
  `truncate-sim.js` and `.env.sim` go with it. Past eval dumps under
  `backend/sim-output/` are untouched but are no longer regenerable.

### Fixed

- **`CORS_ORIGIN` now accepts more than one origin.** It was handed to `enableCors`
  as a single string, so a comma-separated value was echoed back whole in
  `Access-Control-Allow-Origin` — which browsers reject outright ("contains multiple
  values, but only one is allowed"), blocking the web frontend. It is now split into
  a list, and the matching origin alone is reflected.

### Added

- **Mobile app scaffold** (`mobile/`): an Expo Router app on uniwind +
  react-native-reusables, with the login screen, the shared UI primitives, and the
  "Warm Sunrise" theme. It joins the pnpm workspace; `android/`/`ios/` are not tracked
  (Expo CNG regenerates them from `app.json`). Backend `CORS_ORIGIN` now accepts a
  comma-separated list so Expo's web target on `:8081` can reach the API in dev.

### Internal

- The pure scheduler primitives moved to `backend/src/scheduler/utils/` (edf, slot,
  horizon, overflow, reranker, rationale, duration-bias, telemetry, matrix-decay, rng)
  and gained `displace.ts`. The purity split is unchanged: `scheduler.service.ts`
  remains the only file touching Prisma or writing telemetry.

---

## [1.1.1] — 2026-06-28

### Fixed

- **Bandit: preference matrix no longer zeroed by nightly decay.**
  The root cause was `preferenceMatrix` being declared as `Int[]` (`INTEGER[]`) in Prisma.
  The pg driver truncates JavaScript floats when writing to integer columns, so a cell
  holding a single `+1` signal was written as `0` on the very first decay run
  (`0.9677 → 0`). Even with rounding, integer storage breaks the exponential
  accumulation — each day reads `1`, multiplies by `0.9677`, and rounds back to `1`
  forever, so the 21-day half-life never ran. Fixed via migration
  `20260628120000_preference_matrix_float`: the column is now `Float[]`
  (`DOUBLE PRECISION[]`); existing integer values are widened losslessly. The heatmap
  "quickly became all gray" symptom is resolved.

- **Calendar: drag and resize now work correctly on tasks that cross midnight.**
  Head segments (`continues: true`) carry the real task start time and are fully
  interactive: dragging preserves the original duration; bottom-resize can extend
  end past `DAILY_HORIZON`; top-resize computes duration as
  `DAILY_HORIZON + tailMinutes − newStart` so the next-day end stays fixed rather
  than being truncated at midnight. Tail segments (`continued: true`) remain
  click-only because their clamped midnight start has no meaningful on-grid meaning
  for top-edge resize.

### Added

- **Calendar: scroll-to and ring-glow highlight for newly scheduled tasks.**
  After a task is created the day-grid smoothly scrolls to the scheduled block and
  plays a ring-glow pulse animation so the user's eye is drawn to where the EDF
  engine placed it. The signal is carried through a lightweight Zustand store
  (`use-highlight-store`); the animation clears itself via `onAnimationEnd`. Works
  for both the direct-schedule and overflow-resolve paths.

- **UI: exact scheduled time in the creation toast.**
  The toast now reads "Scheduled for Mon Jun 23, 14:00" instead of a generic success
  message. The overflow toast is also triggered whenever the backend returns an
  overflow condition (task placed outside the view period or unplaced), not only when
  `scheduledStartTime` is `null`.

- **Scheduler: per-update learning rate (η = 0.1) for preference-matrix nudges.**
  `applyPreferenceDeltas` now scales each delta by `PREFERENCE_LEARNING_RATE` (0.1)
  before adding it to the cell, so ten consistent signals are needed to reach the
  ±1 ceiling. The existing exponential decay (half-life 21 days) continues to handle
  forgetting stale preferences independently. New `telemetry.spec.ts` covers the
  learning-rate invariants.

---

## [1.1.0] — 2026-06-27

### Fixed

- **Scheduler: tasks no longer silently auto-bump past the current view period.**
  The EDF sort (`compareEdf`) previously ranked period-bounded tasks (those with a
  `schedulingDeadline` but no explicit user deadline) at the same priority as fully
  unbounded tasks. They could lose slots to unbounded tasks until their period closed,
  then overflow without prompting. The sort key is now
  `min(deadline, schedulingDeadline)`, so period-bounded tasks claim earlier slots
  first and stay within the day/week/month they were created in.

### Added

- **Drag-drop: undo toast when a task is moved outside its view period.**
  After dragging a task to a slot outside the day/week/month it was created in, a
  toast appears ("Task moved outside this week") with **Keep** and **Undo** actions.
  Undo reverts the move by re-calling the reschedule endpoint with the original start
  time and refreshes the calendar. The move is committed immediately so the drag feels
  instant; no confirmation dialog blocks the interaction.

- **Create-task overflow: specific date range in the overflow modal.**
  When a newly created task cannot be scheduled within the current view period (e.g.
  the week is fully booked), the overflow modal now reads "No room left in the week of
  Jun 22–28" rather than the generic period label. The date range is computed from the
  calendar's active view on the frontend.

- **`RescheduleResponse.outsideViewPeriod?: boolean`** _(shared API contract)_
  The reschedule endpoint now returns this flag when a drag lands outside the task's
  stored view period. Existing consumers that do not read the field are unaffected.

---

## [1.0.0] — 2026-06-25

First tagged release. The headline of this version is **Phase 2 personalized
scheduling** (PR [#17](https://github.com/alphatrann/zenflow/pull/17)): the
scheduler stops placing tasks impersonally and starts learning each user's
habits — *when* they like to work and *how long* their tasks really take — and
explains every decision it makes in the product.

### Added

- **Personalized slot placement.** The scheduler now learns your preferred
  working times and re-orders the legal time slots for a task toward the ones
  you tend to keep. Earliest-Deadline-First still decides what's *feasible*
  (deadlines, work hours, the 15-minute grid are never violated); personalization
  only decides which feasible slot to *prefer*. A brand-new user with no history
  is scheduled exactly as before, so there's no cold-start surprise.
- **Preference learning over time.** Keeping or moving a task toward a time
  nudges that time up; moving away nudges it down. These preferences are tracked
  on a weekday × hour grid and slowly fade if you stop reinforcing them, so the
  schedule tracks your *current* routine rather than old habits.
- **Per-tag duration correction.** Zenflow learns how long your tagged work
  actually takes versus your estimate (e.g. `#backend` tasks that consistently
  run long) and reserves a realistic amount of time for new tasks accordingly.
- **Duration-adjustment modes (auto / ask / never).** A new preference controls
  how duration corrections are applied:
  - **auto** — apply the corrected duration and show an undoable toast.
  - **ask** — prompt you to accept the correction or keep your estimate.
  - **never** — never change your estimate (Zenflow still *learns* in the
    background so your insights stay meaningful).
  Configurable in onboarding and in Settings.
- **Scheduling transparency.** When a task lands in a slot driven by your
  preferences, a rationale toast explains *why* ("you usually keep work in the
  morning", the time windows that drove the pick). Duration changes surface their
  own toasts naming the tag(s) responsible.
- **Preference heatmap (Insights).** A new Insights tab visualizes your learned
  weekday × hour preference grid, so the personalization is legible instead of a
  black box.
- **Redesigned Settings.** A tabbed Settings dialog (Work hours & days ·
  Scheduling · Insights · Account) replaces the previous single-pane settings,
  with a tag-bias panel showing the learned per-tag duration multipliers.
- **Cross-midnight fixed tasks.** Fixed tasks can now span midnight (start time
  later than end time, e.g. a 23:00–01:00 block). A **+1** badge marks an end
  time that falls on the next day.
- **Shareable calendar state.** The active calendar view (day/week/month) and the
  focused date are now reflected in the URL, so a calendar view can be
  bookmarked, shared, or restored on reload.

### Changed

- **Sender identity.** OTP login emails now come from "Zenflow".
- **Toasts** no longer repeat the task title in the toast heading, avoiding
  overflow on long titles.
- Conflicting tasks now render **side by side** in the calendar instead of
  stacking, and task history refreshes live as you drag or resize.

### Fixed

- Dragging or resizing a task across midnight now behaves correctly, including
  automatically carrying a block into the next day.
- The rationale toast no longer fires on manual drag (it's only meaningful for
  automatic placement).
- Resolved a 404 that could occur when rescheduling an existing task.
- The preference heatmap is aligned to the underlying grid so one cell maps to
  exactly one hour.

### Internal

- Added an offline **simulation & evaluation harness** (synthetic personas,
  significance testing, preference/duration "recovery" scoring, replay-based
  off-policy evaluation) used to *prove* the new scheduling heuristics beat the
  previous behavior before they ship. See [`docs/heuristic.md`](docs/heuristic.md),
  [`docs/phase-2-evaluation-results.md`](docs/phase-2-evaluation-results.md), and
  the [Phase 2 ADR](docs/adr/0001-phase-2-scheduling-heuristic-and-transparency-ui.md).
- The scheduler core stays pure and deterministic: the preference matrix, per-tag
  bias tables, time-decay, and the exploration seed are all computed in the
  service layer and passed into the core (no I/O or uncontrolled randomness in
  `edf.ts` / `reranker.ts`).
- New API surface: `GET /users/me/preference-matrix` and `GET /users/me/tag-bias`
  for the Insights/transparency UI; `durationAdjustmentMode` accepted on the
  preferences and onboarding endpoints; schedule/reschedule responses now carry
  optional rationale and real duration-correction metadata.
- Data model: added `User.durationAdjustmentMode` and
  `User.preferenceMatrixDecayedAt`; the preference matrix is now a weekday × hour
  (7×24) grid that the scheduler reads and a daily job decays.
