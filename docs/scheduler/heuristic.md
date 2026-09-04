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
| `backend/src/scheduler/core/series-spread.ts` | pure — `seriesDayOffsets` (even spread) + `clampWindowForMember` (± X/N window) |
| `backend/src/scheduler/io/matrix-decay.service.ts` | nightly exponential decay of every user's `preferenceMatrix` |
| `backend/src/scheduler/io/retained-sessions.service.ts` | half-hourly RETAINED sweep (the "keep" signal) |
| `backend/src/scheduler/core/recurrence.ts` | `expandRrule` — DND series → occurrence instants |

## The preference matrix

`User.preferenceMatrix` is a flat `Float[]` of length **168** — 7 ISO weekdays × 24
one-hour buckets, row-major by weekday (`matrixIndex(isoWeekday, hour) = (isoWeekday-1)*24 + hour`).
Signed floats. Cold-start fill (`defaultPreferenceMatrix`): weekday 08–11h → `1`,
14–17h → `0.5`, 19–22h → `0.2`, everything else `0` (never negative).

Nightly, `MatrixDecayService` multiplies every cell by `2^(-Δdays / 21)` (≈3-week half-life)
and stamps `preferenceMatrixDecayedAt`.

There is **no acquisition writer yet** — nothing increments/decrements cells from user
moves/keeps. `PREFERENCE_LEARNING_RATE` is reserved for that future phase.

## The algorithm

The scheduler places **only the session in hand** — it never repacks a day or moves an
existing session (`reranking.md`). `SessionsService` calls
`HeuristicScheduleService.scheduleTask` after a `TASK` is created and after a `TASK`
deadline changes. Adding a fixed / DND session schedules nothing (they are user-pinned).

`scheduleTask(user, { id, durationMinutes, deadline }, tz, preferenceMatrix, now)`:

1. For every local calendar day from `next_15min(now)` through the deadline (capped at
   `MAX_SCAN_DAYS`), load that day's `occupied` intervals (fixed sessions, DND
   occurrences, other placed TASKs — via `loadDayLoad`, excluding this task's own row).
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

## Session series (`sessionCount > 1`)

Creating a `TASK` with `sessionCount: N` (N > 1) makes one `SessionSeries` (`type: TASK`,
shared `deadline`, no `rrule`) and N linked `Session` rows (`sessionIndex` 1..N,
`sessionTotal` N), then hands the batch to `SeriesPlacer.placeSeries`:

- **Even spread.** `seriesDayOffsets(daySpan, N)` targets session `i` at
  `round(i · daySpan / (N − 1))` days from the scan start — first session on day 0, last on
  the deadline day, the rest evenly between (`round` lets a few drift a day).
- **Bounded window.** `clampWindowForMember` gives each member the day range
  `target ± max(1, floor(daySpan / N))`, clamped to `[0, daySpan]` — wide for a sparse
  series, `±1` for a dense one. The member is then placed **through the same 50/50
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

DND blocks and fixed types never emit move/keep signals.

## Relationship to the A/B experiment

In the LinUCB A/B test ([`ab-testing.md`](./ab-testing.md)), "Policy A" **is** the
algorithm above (`HeuristicPlacer.placeTask`) — single-session, empty-slot-only, nothing
else moved — so it is already on equal footing with the LinUCB policy, which also only ever
places the current session (`reranking.md`). LinUCB, when it is the assigned primary policy
and produces a pick, overrides the heuristic placement for that one session. The shared
slot realization — the overlap-weighted `slotPreferenceScore`, earliest-start tie-break —
lives in `core/slot-score.ts`. `TASK`-series members go through the same 50/50 pick as a
single task, each within a `± floor(X/N)`-day window (`SeriesPlacer`).

