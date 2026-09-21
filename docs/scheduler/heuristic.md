# Zenflow Scheduling Heuristic

The live scheduler. A pure, deterministic rank-then-best-fit placer with a per-user
preference matrix. No global optimization, no randomness, no I/O in the core.

> Historical note: this file consolidates the algorithm notes that used to live in
> `notes.md` / a since-removed `docs/heuristic.md`. The phased "EDF → Phase 2 heuristics →
> Phase 3 LinUCB" roadmap those older docs described is superseded — Phase 1's EDF engine
> was deleted (commit `6d3f42b`) and Phase 2's re-ranker was never built. What ships today
> is only what is below. LinUCB design lives in
> [`docs/adr/0001-linucb-model-design.md`](../adr/0001-linucb-model-design.md) and
> [`docs/scheduler/reranking.md`](./reranking.md); the move-or-keep signal model is
> [`docs/adr/0002-scheduling-simplification.md`](../adr/0002-scheduling-simplification.md).

## Pieces

> **Reorg note.** The scheduler was split into a pure `scheduler/core/*` and an I/O
> `scheduler/io/*` layer — see [`backend/README.md` → "Scheduler architecture"](../../backend/README.md#scheduler-architecture)
> for the current file map, diagrams, and a source-trace table. Three behavior changes
> landed with the split: `slotPreferenceScore` is now **overlap-weighted** (see below);
> the LinUCB slot score adds `slotPreferenceScore` as a cold-start blend
> ([`reranking.md`](./reranking.md) §3); and `TASK`-series members now go through the
> per-member 50/50 A/B pick within a `± floor(X/N)`-day window (`dayVisitOrder` is gone).

| File | Role |
| --- | --- |
| `backend/src/scheduler/core/slot-score.ts` | pure core — `bestFreeSlot`, `slotPreferenceScore` (overlap-weighted) |
| `backend/src/scheduler/core/preference.ts` | pure — `matrixIndex`, default/effective matrix, `preferenceScoreAt` |
| `backend/src/scheduler/io/heuristic-placer.service.ts` | Prisma layer — loads each candidate day's `occupied`, picks one slot (`placeTask` / `placeInWindow`) |
| `backend/src/scheduler/io/series-placer.service.ts` | `SeriesPlacer` — per-member bounded 50/50 placement of a `sessionCount` series |
| `backend/src/scheduler/core/series-spread.ts` | pure — `seriesDayWindows` (non-overlapping per-member day buckets) |
| `backend/src/scheduler/io/matrix-decay.service.ts` | nightly exponential decay of every user's `preferenceMatrix` |
| `backend/src/scheduler/io/retained-sessions.service.ts` | half-hourly RETAINED sweep (the "keep" signal) |
| `backend/src/scheduler/core/recurrence.ts` | `expandRrule` — any recurring series (`DND` or a recurring `ASSIGNMENT`/`EXAM`/`LECTURE`) → occurrence instants |

## The preference matrix

`User.preferenceMatrix` is a flat `Float[]` of length **168** — 7 ISO weekdays × 24
one-hour buckets, row-major by weekday (`matrixIndex(isoWeekday, hour) = (isoWeekday-1)*24 + hour`).
Signed floats. Cold-start fill (`defaultPreferenceMatrix`): weekday 08–11h → `1`,
14–17h → `0.5`, 19–22h → `0.2`, everything else `0` (never negative).

Nightly, `MatrixDecayService` multiplies every cell by `2^(-Δdays / 21)` (≈3-week half-life)
and stamps `preferenceMatrixDecayedAt`.

Cells are also reinforced per event (`η = PREFERENCE_LEARNING_RATE = 0.1`), for both
policies, and clamp to `[-1, 1]`:

- **First move** of a placed session (drag, start-side resize, or slot pick —
  `reinforcePreferenceMove`): old hour `−η·g`, new hour `+η·g`, with
  `g = -dragDistanceReward(dragMinutes) ∈ [0, 1]` (saturates at `MOVE_REWARD_SCALE_MINUTES = 240`).
  Resizing only the end doesn't move the start, so it is not a move.
- **RETAINED**: kept hour `+η·PREFERENCE_RETAINED_WEIGHT` (`0.25`).

LinUCB's own reward is separate: `dragDistanceReward` on MOVE, `+1` on RETAINED.

## The algorithm

The scheduler places **only the session in hand** — it never repacks a day or moves an
existing session (`reranking.md`) — except in the last-resort *Displacement* case below, when a
`TASK` has no free slot before its deadline. `SessionsService` calls
`HeuristicScheduleService.scheduleTask` after a `TASK` is created and after a `TASK`
deadline changes. Adding a fixed / DND session schedules nothing (they are user-pinned).

`scheduleTask(user, { id, durationMinutes, deadline }, tz, preferenceMatrix, now)`:

1. For every local calendar day from `next_15min(now)` through the deadline (capped at
   `MAX_SCAN_DAYS`), load that day's `occupied` intervals — via `loadDayLoad`, excluding
   this task's own row: standalone fixed sessions, other placed/materialized `TASK`
   sittings (including another series' members), and every occurrence of every recurring
   series (`DND`, or a recurring `ASSIGNMENT`/`EXAM`/`LECTURE`), expanded from its
   representative row.
   `loadDayLoad` looks a day back and a task-length forward of the nominal `[00:00, 24:00)`
   so a session that started the previous evening and runs past midnight — or one this
   scan might place across the *next* midnight — is visible for collision checks.
2. On each day, `bestFreeSlot` scans every 15-minute-aligned start in
   `[max(now, dayStart), min(deadline, nextMidnight))`, skips any that overlap `occupied`,
   and scores each free slot with `slotPreferenceScore` — the **overlap-weighted** sum over
   every clock-hour block `[h, h+1)` the `[start, start+duration)` interval touches of
   `overlapFraction · pref[weekday(h)][h]`. A partially-covered hour contributes
   fractionally: a 09:15–11:00 slot scores `0.75·pref[..][9] + 1.0·pref[..][10]`. A
   midnight-spanning slot is split at local midnight and each side scored against its own
   weekday row.
   **Cross-midnight:** a slot may *start* before that day's `nextMidnight` and *finish*
   after it, up to `min(deadline, nextMidnight + duration − one slot)` — so a task can be
   placed at e.g. 23:00 and run to 01:30. The post-midnight hours are ordinary candidate
   time; the preference matrix decides whether they're ever chosen (a day-person's matrix
   scores 00:00–06:00 ≈ 0, so those slots only win when nothing better fits). The two
   ceilings are `bestFreeSlot`'s `windowEnd` (latest start) and `fitWindowEnd` (latest
   end); `loadDayLoad`'s `occupiedLookaheadMs` widens only the collision scan, not the
   day's workload accounting.
3. The single highest-scoring slot across **all** days wins; earliest start breaks ties.
   `null` when nothing free fits before the deadline — the task stays unscheduled.

Both the single-`TASK` heuristic and the LinUCB path now allow a slot to run past local
midnight up to the deadline (`overlapRate` splits a straddling slot at midnight rather than
rejecting it). Series members are placed one day-window at a time and rarely need to
straddle, but nothing forbids it.

No telemetry is written here; the A/B `SlotProposal` row (when the experiment runs) is the
only record.

Since issue #62 the day loads for a scan come from **one** range query
(`loadDayLoads` — `loadScheduleItems` + pure `dayLoadFromItems`), and single-task placement
scans at most `SCAN_CAP_DAYS` (30) days; `MAX_SCAN_DAYS` (60) is unchanged because it also
normalizes the LinUCB context vector, and series placement still spans it.

## Displacement of flexible tasks (issue #62 B)

Everything above places into *empty* slots. When that finds nothing before the deadline
(`TaskPlacementService`), the engine tries, in order:

1. **Repack** (`core/displacement.ts` `planDisplacement`, I/O in `DisplacementService`).
   Standalone `TASK` rows that have not started are *flexible*; everything else — DND /
   ASSIGNMENT / EXAM / LECTURE, recurring occurrences, `TASK`-series sittings — is *fixed* and
   never moves. On the deadline's local day (widening to +/-1 day only if infeasible) it
   evaluates the top `DISPLACEMENT_CANDIDATES` preference-ranked slots for the new task, and for
   each simulates an earliest-deadline-first cascade: a flexible task stays put if it no longer
   collides, else it is re-placed with `bestFreeSlot` inside its own deadline and the window.
   Cascades are capped at `MAX_DISPLACED_TASKS` moves; the candidate with the fewest moves
   (then best preference) wins. A slot at an uncomfortable hour is accepted — comfort is only a
   score, feasibility is not.
2. **User's choice** if still infeasible. The create/edit is rejected with
   `409 { code: "SCHEDULE_INFEASIBLE", options: [...] }` (nothing persisted); the client retries
   with `infeasiblePolicy`:
   - `ACCEPT_CONFLICTS` — `pickMinConflictSlot`: the pre-deadline start overlapping the least
     calendar time.
   - `ACCEPT_LATE_DEADLINE` — `pickLateSlot`: the first conflict-free start whose end passes the
     deadline (`Session.late = true`, red block in the UIs).

`now + duration > deadline` is always a plain `400` (no policy can help), on create and on a
deadline edit. A series member's deadline edit only gets that arithmetic guard.

Scheduler-initiated moves are recorded as **`SYSTEM_MOVE`** `SessionEvent`s (`rewardScore = 0`).
They never write a `MOVE`, never call `/update`, never reinforce the preference matrix, and do
not count toward `observationCount`.

## Sync conflicts (issue #62 D)

After a timetable / exam / LMS sync writes fixed blocks, `SyncConflictsService` finds the
user's own scheduled `TASK`s now overlapping them (`core/sync-conflicts.ts`) and raises one
notification per source (`TIMETABLE_CONFLICT`, `EXAM_CONFLICT`, `ASSIGNMENT_CONFLICT`):
"After syncing with ..., we detected X conflicts with your own tasks. Reschedule them all?".
It is a no-op with zero conflicts and deduped while an identical un-acted notification is
open. `POST /notifications/:id/reschedule-conflicts` re-places each still-conflicting task
through the normal placement path (earliest deadline first) as `SYSTEM_MOVE`s.

## Session series (`sessionCount > 1`)

Creating a `TASK` with `sessionCount: N` (N > 1) makes one `SessionSeries` (`type: TASK`,
shared `deadline`, no `rrule`) and N linked `Session` rows (`sessionIndex` 1..N,
`sessionTotal` N), then hands the batch to `SeriesPlacer.placeSeries`:

- **Non-overlapping windows.** `seriesDayWindows(daySpan, N)` partitions the `daySpan + 1`
  days into `N` contiguous buckets — `base = floor(totalDays / N)` days each, with the LAST
  `totalDays % N` buckets getting one extra day. Member `i`'s window is exactly its bucket:
  no two members' windows can ever overlap, unlike the earlier "even-spread target ± a
  symmetric clamp" scheme, whose overlapping windows could let two sessions cluster onto one
  day while a neighboring day sat empty. The member is then placed **through the same 50/50
  heuristic-or-LinUCB pick as a single task**, restricted to that window; a day already
  holding `MAX_SERIES_PER_DAY` (= 3) sittings of this series is skipped.
- Siblings never overlap (each placement is fed forward as a hard block). A member with
  nowhere to go comes back unscheduled without blocking the others. One `SlotProposal` is
  recorded per member.

Editing any series member's **deadline** pushes the new deadline onto the series row and
every member, then re-runs the same per-member bounded placement for the sittings that have
not started yet — a shorter window tightens the spacing, a longer one relaxes it. Past
sittings keep their slot. Editing one member's deadline is the whole-series deadline edit;
there is no per-member deadline.

### Editing `sessionCount` (`SeriesService.resizeSessionCount`)

`PATCH /sessions/:id` with `sessionCount` resizes an existing `TASK` series post-creation —
the edit-mode counterpart of the create-time session-count slider:

- **Grow** (`sessionCount` > current member count) — a pre-flight feasibility check
  (`TaskPlacementService.canPlaceSeries`, over just the *added* sittings) rejects the whole
  resize up front if they have nowhere to fit; otherwise `targetCount − memberCount` new rows
  are cloned from the representative member (title/note/location/tags/duration/deadline),
  `sessionIndex` continuing from the current max, and placed via
  `TaskPlacementService.placeSeriesOnCreate` — since the existing members are already
  persisted rows, the normal day-load occupancy scan schedules around them without moving
  them. `sessionTotal` is rewritten onto every member, old and new, and each new row gets its
  own `CREATE` `SessionEvent`.
- **Shrink** (`sessionCount` < current member count) — always drops the highest-`sessionIndex`
  (most recently added) sittings first; rejected outright, with nothing written, if any of
  those has already started (`scheduledStartTime ≤ now`). `sessionTotal` is rewritten onto the
  survivors.
- **Promotion** — a plain single `TASK` (no series yet) patched with `sessionCount > 1` is
  first promoted into a 1-member `SessionSeries` (`SeriesService.promoteToSeries`), then grown
  exactly like the series case above — symmetric with create-mode's "raise the count to make
  a series."

The N `CREATE` events share a `batchId` (echoed on `CreateSessionResponse.batchId`).
Reverting a batch, or clearing a series outright, is `DELETE /sessions/series/:seriesId`;
`DELETE /sessions/series/:seriesId/from/:sessionId` drops that session and every later one
(`sessionIndex` order) and keeps the earlier ones. Each surviving session stays an
ordinary, independently editable/movable/deletable `Session` row.

## Move-or-keep signal

- User drag/resize of a scheduled `TASK` → `PATCH /sessions/:id` → a `MOVE` `SessionEvent`
  (`rewardScore = -1`, `dragDistanceMinutes` signed) + `Session.lastMovedAt`.
- A `TASK` whose interval + 15-minute grace has elapsed with `lastMovedAt == null` →
  `RetainedSessionsService` writes a `RETAINED` `SessionEvent` (`rewardScore = +1`) +
  `Session.retainedAt`.
- `CREATE` events carry `rewardScore = 0`.
- Scheduler-initiated moves (displacement, "reschedule all") are `SYSTEM_MOVE` events with
  `rewardScore = 0` — no user signal, no preference update.

DND blocks and fixed types never emit move/keep signals.

## Relationship to the A/B experiment

In the LinUCB A/B test ([`ab-testing.md`](./ab-testing.md)), "Policy A" **is** the
algorithm above (`HeuristicPlacer.placeTask`) — single-session, empty-slot-only, nothing
else moved — so it is already on equal footing with the LinUCB policy, which also only ever
places the current session (`reranking.md`). LinUCB, when it is the assigned primary policy
and produces a pick, overrides the heuristic placement for that one session. The shared
slot realization — the overlap-weighted `slotPreferenceScore`, earliest-start tie-break —
lives in `core/slot-score.ts`. The heuristic stays **preference-only**: it never uses the
adaptive `wL`/`wP` blend or any arm score (those apply only to LinUCB, ADR-0001 §13), which is
what keeps the two policies distinct. `TASK`-series members go through the same 50/50 pick as a
single task, each within a `± floor(X/N)`-day window (`SeriesPlacer`).

