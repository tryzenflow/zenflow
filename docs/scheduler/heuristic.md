# Zenflow scheduling heuristic — frozen TS fallback

> **ADR-0003 superseded this document's original scope.** Until phase 6, this file described
> the TS heuristic as the **primary** placement algorithm (Policy A of the LinUCB A/B
> experiment). That is no longer true: `POST /v1/place` in `services/bandit` is now the sole
> authoritative placement path — heuristic best-free-slot, LinUCB slot-first scoring, series
> spreading, and displacement all run there (pure numpy, `services/bandit/src/core/*`). What
> remains in `backend/src/scheduler/core/*` is a **frozen** copy of the pre-#62 TS heuristic,
> used only as `FallbackPlacer` — the degraded-mode driver when `/v1/place` is unreachable
> (timeout, breaker open, `BANDIT_SERVICE_URL` unset, contract-version mismatch). This document
> now describes that frozen fallback only. For the live, authoritative algorithm see
> [`services/bandit/README.md`](../../services/bandit/README.md) and
> [`docs/adr/0003-python-authoritative-placement.md`](../adr/0003-python-authoritative-placement.md).
> LinUCB design history lives in
> [`docs/adr/0001-linucb-model-design.md`](../adr/0001-linucb-model-design.md) and
> [`docs/scheduler/reranking.md`](./reranking.md) (superseded the same way — describes the
> A/B experiment as it ran while TS was authoritative; the experiment's shape —
> `ExperimentService.assignPolicy`, `SlotProposal`, pairwise sampling — is unchanged, only
> which side does the ranking moved).

## When this code runs

`FallbackPlacer` (`backend/src/scheduler/io/fallback-placer.service.ts`), built on
`HeuristicPlacer` (`backend/src/scheduler/io/heuristic-placer.service.ts`), is invoked by
`PythonPlacer` only when `PlacementClient` reports a failure: connect/timeout, 5xx, circuit
breaker open, or `BANDIT_SERVICE_URL` unset/disabled. It:

- Never displaces another session, never accepts conflicts or a late deadline, never rolls the
  A/B policy — a caller that finds no slot here gets `503 SCHEDULER_DEGRADED` (retryable, nothing
  written).
- Is preference-only: no adaptive LinUCB blend, no arm score, no context vector. Comfort is a
  score, feasibility is a hard yes/no.
- Places **only the session in hand** — it never repacks a day or moves an existing session.

File header convention: `FROZEN FALLBACK (ADR-0003): bug fixes only; behaviour changes belong
in services/bandit`. A change here must keep
`backend/test/golden/scheduler-core.golden.json` (`pnpm --filter backend golden:export`) and
`services/bandit/tests/test_golden_ts.py` green — see
[`backend/README.md` → "Scheduler architecture"](../../backend/README.md#scheduler-architecture)
for the current file map, diagrams, and source-trace table.

| File | Role |
| --- | --- |
| `backend/src/scheduler/core/slot-score.ts` | **frozen** — `bestFreeSlot`, `slotPreferenceScore` (overlap-weighted), `stabilityScore` |
| `backend/src/scheduler/core/preference.ts` | `matrixIndex`, default/effective matrix, `preferenceScoreAt` (reinforcement stays live — see below) |
| `backend/src/scheduler/io/heuristic-placer.service.ts` | Prisma layer — loads each candidate day's `occupied`, picks one slot (`placeTask` / `placeInWindow`) |
| `backend/src/scheduler/io/fallback-placer.service.ts` | `FallbackPlacer` — degraded-mode driver; `placeSingle` / `placeSeries`, all-or-nothing |
| `backend/src/scheduler/core/series-spread.ts` | **frozen** — `seriesDayWindows` (non-overlapping per-member day buckets) |
| `backend/src/scheduler/io/matrix-decay.service.ts` | nightly exponential decay of every user's `preferenceMatrix` (mode-independent) |
| `backend/src/scheduler/io/retained-sessions.service.ts` | half-hourly RETAINED sweep (the "keep" signal, mode-independent) |
| `backend/src/scheduler/core/recurrence.ts` | `expandRrule` — any recurring series (`DND` or a recurring `ASSIGNMENT`/`EXAM`/`LECTURE`) → occurrence instants (mode-independent) |

## The preference matrix

`User.preferenceMatrix` is a flat `Float[]` of length **168** — 7 ISO weekdays × 24
one-hour buckets, row-major by weekday (`matrixIndex(isoWeekday, hour) = (isoWeekday-1)*24 + hour`).
Signed floats. Cold-start fill (`defaultPreferenceMatrix`): weekday 08–11h → `1`,
14–17h → `0.5`, 19–22h → `0.2`, everything else `0` (never negative). This matrix is sent to
Python as part of every `PlaceRequest` — Python's heuristic/LinUCB scoring reads the same
matrix the frozen fallback does, so degraded mode isn't scoring against stale personalization.

Nightly, `MatrixDecayService` multiplies every cell by `2^(-Δdays / 21)` (≈3-week half-life)
and stamps `preferenceMatrixDecayedAt`. This is mode-independent — it runs regardless of
whether the last placement was served by Python or the fallback.

Cells are also reinforced per event (`η = PREFERENCE_LEARNING_RATE = 0.1`), for both
policies, and clamp to `[-1, 1]`:

- **First move** of a placed session (drag, start-side resize, or slot pick —
  `reinforcePreferenceMove`): old hour `−η·g`, new hour `+η·g`, with
  `g = -dragDistanceReward(dragMinutes) ∈ [0, 1]` (saturates at `MOVE_REWARD_SCALE_MINUTES = 240`).
  Resizing only the end doesn't move the start, so it is not a move.
- **RETAINED**: kept hour `+η·PREFERENCE_RETAINED_WEIGHT` (`0.25`).

LinUCB's own reward is separate: `dragDistanceReward` on MOVE, `+1` on RETAINED — sent to
Python's `/update` (`BanditService`), regardless of which policy placed the session.

## The frozen algorithm

`HeuristicPlacer.placeTask(user, { id, durationMinutes, deadline }, tz, preferenceMatrix, now)`
— called only from `FallbackPlacer`:

1. For every local calendar day from `next_15min(now)` through the deadline (capped at
   `SCAN_CAP_DAYS` for a single task, `MAX_SCAN_DAYS` for a series), load that day's `occupied`
   intervals — via `loadDayLoad`/`loadDayLoads`, excluding this task's own row: standalone
   fixed sessions, other placed/materialized `TASK` sittings (including another series'
   members), and every occurrence of every recurring series (`DND`, or a recurring
   `ASSIGNMENT`/`EXAM`/`LECTURE`), expanded from its representative row.
   `loadDayLoad` looks a day back and a task-length forward of the nominal `[00:00, 24:00)`
   so a session that started the previous evening and runs past midnight — or one this
   scan might place across the *next* midnight — is visible for collision checks.
2. On each day, `bestFreeSlot` scans every 15-minute-aligned start in
   `[max(now, dayStart), min(deadline, nextMidnight))`, skips any that overlap `occupied`,
   and scores each free slot with `slotPreferenceScore` — the **overlap-weighted** sum over
   every clock-hour block `[h, h+1)` the `[start, start+duration)` interval touches of
   `overlapFraction · pref[weekday(h)][h]`, plus `stabilityScore` (a light nudge toward the
   previous manually-set start, on an edit). A partially-covered hour contributes
   fractionally: a 09:15–11:00 slot scores `0.75·pref[..][9] + 1.0·pref[..][10]`. A
   midnight-spanning slot is split at local midnight and each side scored against its own
   weekday row.
   **Cross-midnight:** a slot may *start* before that day's `nextMidnight` and *finish*
   after it, up to `min(deadline, nextMidnight + duration − one slot)` — so a task can be
   placed at e.g. 23:00 and run to 01:30. The post-midnight hours are ordinary candidate
   time; the preference matrix decides whether they're ever chosen. The two ceilings are
   `bestFreeSlot`'s `windowEnd` (latest start) and `fitWindowEnd` (latest end); `loadDayLoad`'s
   `occupiedLookaheadMs` widens only the collision scan, not the day's workload accounting.
3. The single highest-scoring slot across **all** days wins; earliest start breaks ties.
   `null` when nothing free fits before the deadline — `FallbackPlacer.placeSingle` reports
   that as "nothing free," and the caller (`PythonPlacer`) answers `503 SCHEDULER_DEGRADED`.

No telemetry is written by the frozen fallback itself — `PythonPlacer` records the
`SlotProposal` (`placementSource = TS_FALLBACK`, `modelProposal = null`, a `degradedReason`)
around it.

## Series (degraded mode only)

`FallbackPlacer.placeSeries` places every member of a `sessionCount > 1` series through the
frozen loop, all-or-nothing: `seriesDayWindows(daySpan, N)` (`core/series-spread.ts`,
**frozen**) partitions the `daySpan + 1` days into `N` contiguous, non-overlapping buckets —
`base = floor(totalDays / N)` days each, with the LAST `totalDays % N` buckets getting one
extra day. Member `i`'s window is exactly its bucket: no two members' windows can ever overlap.
Each member is placed by the same `HeuristicPlacer.placeInWindow` scan restricted to its
window; a day already holding `MAX_SERIES_PER_DAY` sittings of this series is skipped; siblings
never overlap (each placement is fed forward as a hard block). Any member with nowhere to go
makes the whole series call fail `503 SCHEDULER_DEGRADED` — there is no partial-series
degraded result (contrast with Python's authoritative path, which is per-member; see
`services/bandit/README.md`).

## What moved to Python (not described here any more)

- **Displacement** (EDF repack of flexible `TASK`s) and the two infeasible fallbacks
  (`ACCEPT_CONFLICTS`/`ACCEPT_LATE_DEADLINE`) — `services/bandit/src/core/displacement.py`,
  reached via `/v1/place`'s two-phase infeasible flow (ADR-0003 §3.3). The degraded mode has
  **no** displacement or accept-conflicts/late at all — see the table in
  [`backend/README.md`](../../backend/README.md#python-authoritative-placement-adr-0003).
  `backend/src/scheduler/io/displacement.service.ts` only *persists* Python's already-computed
  moves (`applyMoves`) — it doesn't plan them any more.
- **LinUCB slot-first scoring** (context vector, arm scoring, proximity-scaled stability `wS`,
  seeded tie-break order) — `services/bandit/src/core/linucb_best_slot.py` and friends. There is no TS LinUCB
  implementation left at all (ADR-0003 phase 6 deleted `linucb-best-slot.ts`, `context-vector.ts`,
  `arms.ts`, `adaptive-weights.ts`, `normalize.ts`; the adaptive blend itself is gone).
- **Series orchestration on the authoritative path** — per-member day windows, the sibling
  ledger, `MAX_SERIES_PER_DAY` — Python's `place.py`. `FallbackPlacer`'s series loop above is
  the only TS series placement left, and only for degraded mode.

## Sync conflicts (issue #62 D, unchanged by ADR-0003)

After a timetable / exam / LMS sync writes fixed blocks, `SyncConflictsService` finds the user's
own scheduled `TASK`s that now overlap them (`core/sync-conflicts.ts` — pure, mode-independent,
still golden-tested). It raises one notification per source: `TIMETABLE_CONFLICT`,
`EXAM_CONFLICT` or `ASSIGNMENT_CONFLICT`.

- No-op with zero conflicts; deduped while an identical un-acted notification is open.
- `POST /notifications/:id/reschedule-conflicts` re-places each still-conflicting task through
  normal placement (`TaskPlacementService` → `PythonPlacer`, earliest deadline first) and
  persists each move as a `SYSTEM_MOVE` via `DisplacementService.applyMoves`.

## Move-or-keep signal (unchanged by ADR-0003)

- User drag/resize of a scheduled `TASK` → `PATCH /sessions/:id` → a `MOVE` `SessionEvent`
  (`rewardScore = -1`, `dragDistanceMinutes` signed) + `Session.lastMovedAt`.
- A `TASK` whose interval + 15-minute grace has elapsed with `lastMovedAt == null` →
  `RetainedSessionsService` writes a `RETAINED` `SessionEvent` (`rewardScore = +1`) +
  `Session.retainedAt`.
- `CREATE` events carry `rewardScore = 0`.
- Scheduler-initiated moves (displacement, "reschedule all") are `SYSTEM_MOVE` events with
  `rewardScore = 0`: no preference update.

DND blocks and fixed types never emit move/keep signals. This whole signal path is
mode-independent — it feeds `/update` regardless of whether the placement that's being
rewarded came from Python or the frozen fallback.
