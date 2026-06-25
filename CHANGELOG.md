# Changelog

All notable changes to Zenflow are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0/).

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
