# ADR-0002: Scheduling & Session-Model Simplification

**Status:** Accepted
**Date:** 2026-08-30 · **Last updated:** 2026-09-07
**Supersedes:** the completion/abandonment lifecycle and the manual "Optimize" surface.

---

## 1. Context

The session model had accreted a full completion lifecycle (`SessionStatus`
`PENDING | DONE | ABANDONED`, `COMPLETE` / `ABANDON` / `KEEP` events, an hourly overdue
sweep) on top of a scheduler that had already been reduced to a single pure heuristic. The
completion states carried little signal — a student rarely marks study work done — while
adding UI (checkmarks, "Mark done", strikethrough) and telemetry surface. This ADR removes
that, adds the education-focused session types, and fixes the personalization signal to a
single **move-or-keep** outcome.

## 2. Decision

### 2.1 Move-or-keep, no completion

A scheduled session has exactly two outcomes:

- **Move** — the user drags or resizes it. `SessionsService.update` writes a `MOVE`
  `SessionEvent` (`rewardScore = -1`, `dragDistanceMinutes` signed) and stamps
  `Session.lastMovedAt`.
- **Keep** — the session's interval elapses and it was never moved. The half-hourly
  `RetainedSessionsService` sweep writes a `RETAINED` `SessionEvent` (`rewardScore = +1`)
  and stamps `Session.retainedAt` (idempotency).

`SessionEventType` is `CREATE | MOVE | RETAINED`. `SessionStatus`, `Session.status`,
`Session.startTime`, and the `OVERDUE` notification topic are removed.

### 2.2 Session types

`SessionType = TASK | ASSIGNMENT | EXAM | LECTURE | DND`:

| Type | Deadline | Scheduled by | Recurrence | Draggable |
| --- | --- | --- | --- | --- |
| `TASK` | required | the engine (into one empty slot) | via `sessionCount > 1` (a materialized series) | yes |
| `ASSIGNMENT` / `EXAM` / `LECTURE` | none | the user (or a DLU sync) pins `scheduledStartTime` | optional `rrule` | yes (a plain field write) |
| `DND` | none | the user pins `scheduledStartTime` | optional `rrule` | yes (a plain field write) |

`Session.deadline` is nullable. The engine places **only** the session being created or
deadline-edited (or the members of one new `TASK` series) into an already-free slot — it
never moves another session. Fixed types and `DND` blocks are hard `occupied` intervals the
placer schedules around.

### 2.3 Manual creation via a 3-tab form

Both clients' create form has a `SessionTypeTabs` selector: **Task** (default) / **Fixed**
(with an Assignment · Exam · Lecture segment) / **Do Not Disturb**. Fixed/DND capture
date + start-time + end-time; the client derives `durationMinutes` and the concrete
`scheduledStartTime`. Every non-`TASK` type gets a constrained RRULE builder
(`FREQ=DAILY|WEEKLY`, `BYDAY`, `UNTIL`).

### 2.4 Series — two kinds

- **Recurring fixed session** (`DND` / `ASSIGNMENT` / `EXAM` / `LECTURE` with an `rrule`) —
  *virtual*: one `SessionSeries` holds the `rrule` + `exdates`, one representative `Session`
  anchors the first occurrence, and `SessionsService.list()` fans it out into occurrences
  whose `id` is `"<seriesId>::<startISO>"` (`expandRrule`, never materialized).
- **Multi-sitting `TASK`** (`sessionCount > 1`) — *materialized*: N real `Session` rows
  share one `seriesId` and `deadline`, each placed independently and spread across
  `now … deadline`.

Editing / deleting a series member is routed by the backend:
`PATCH /sessions/:id` with `scope` (`occurrence` / `following` / `series`) and optional
`skipConflicting`; `DELETE /sessions/:id` on an occurrence id adds it to `exdates`;
`DELETE /sessions/series/:id/truncate?from=<ISO>` pulls a recurring rrule's `UNTIL` back;
`DELETE /sessions/series/:id/from/:sessionId` drops a `TASK` sitting and every later one;
`DELETE /sessions/series/:id` drops the whole series.

### 2.5 A/B experiment

`SlotProposal` holds everything [`docs/scheduler/ab-testing.md`](../scheduler/ab-testing.md)
needs (`experimentId`, `randomizationSeed`, `primaryPolicy`, `observationCount`,
`proposedStartTime` / `appliedStartTime`, `featureVector`, `selectedArm`). `SessionEvent`
carries `dragDistanceMinutes` + `slotProposalId`; both models' `sessionId` is nullable with
`onDelete: SetNull` so history survives a delete.

`ExperimentService` **writes a `SlotProposal` on every `TASK` scheduling event** and assigns
a 50/50 `primaryPolicy` (`HEURISTIC` — Policy A; `LINUCB` — Policy B, calling the Python
bandit service). The delayed reward path (first `MOVE` / `RETAINED` → `/update` →
`BanditArmState`) is live. See [ADR-0001](0001-linucb-model-design.md).

## 3. Consequences

- The migration is destructive (drops `SessionStatus`, `Session.status`, `Session.startTime`,
  rewrites `SessionEventType`). The dev DB is reset; there is no production database.
- Both `frontend/` (the web PWA) and `mobile/` (Expo) are active clients of the
  `@zenflow/shared` contract; shared calendar logic lives in `@zenflow/core`.
- Scheduler code is split into a pure `backend/src/scheduler/core/*` (scoring, ranking, arm
  bands, series math, recurrence, decay — no I/O, no clock, no randomness) and an I/O
  `backend/src/scheduler/io/*` (`HeuristicPlacer`, `BanditPlacer`, `SeriesPlacer`, the
  `TaskPlacementService` facade `sessions/` calls, `SchedulingFeedbackService`, and the two
  `@Cron` services). See [`backend/README.md` → "Scheduler architecture"](../../backend/README.md#scheduler-architecture).
