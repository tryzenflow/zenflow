# ADR-0002: Scheduling & Session-Model Simplification

**Status:** Accepted
**Date:** 2026-08-30 · **Last updated:** 2026-09-07
**Supersedes:** the completion/abandonment lifecycle and the manual "Optimize" surface.

## 1. Context

- The session model had a full completion lifecycle: `SessionStatus` `PENDING | DONE | ABANDONED`, `COMPLETE` / `ABANDON` / `KEEP` events and an hourly overdue sweep.
- It sat on a scheduler already reduced to one pure heuristic.
- Completion carried little signal (students rarely mark study work done) but added UI (checkmarks, "Mark done", strikethrough) and telemetry.
- This ADR removes it, adds education-focused session types and fixes the personalization signal to one move-or-keep outcome.

## 2. Decision

### 2.1 Move-or-keep, no completion

A scheduled session has exactly two outcomes:

- **Move**: the user drags or resizes it.
  - `SessionsService.update` writes a `MOVE` `SessionEvent` (`rewardScore = -1`, signed `dragDistanceMinutes`).
  - It stamps `Session.lastMovedAt`.
- **Keep**: the interval elapses and the session was never moved.
  - The half-hourly `RetainedSessionsService` sweep writes a `RETAINED` `SessionEvent` (`rewardScore = +1`).
  - It stamps `Session.retainedAt` (idempotency).

- `SessionEventType` is `CREATE | MOVE | RETAINED`.
- Removed: `SessionStatus`, `Session.status`, `Session.startTime`, the `OVERDUE` notification topic.

### 2.2 Session types

`SessionType = TASK | ASSIGNMENT | EXAM | LECTURE | DND`:

| Type                              | Deadline | Scheduled by                                       | Recurrence                                      | Draggable                 |
| --------------------------------- | -------- | -------------------------------------------------- | ----------------------------------------------- | ------------------------- |
| `TASK`                            | required | the engine (into one empty slot)                   | via `sessionCount > 1` (a materialized series)  | yes                       |
| `ASSIGNMENT` / `EXAM` / `LECTURE` | none     | the user (or a DLU sync) pins `scheduledStartTime` | optional `rrule`                                | yes (a plain field write) |
| `DND`                             | none     | the user pins `scheduledStartTime`                 | optional `rrule`                                | yes (a plain field write) |

- `Session.deadline` is nullable.
- The engine places only the session being created or deadline-edited (or the members of one new `TASK` series) into an already-free slot.
- It never moves another session.
- Fixed types and `DND` are hard `occupied` intervals the placer schedules around.

### 2.3 Manual creation via a 3-tab form

- Both clients' create form has a `SessionTypeTabs` selector: **Task** (default), **Fixed** (Assignment · Exam · Lecture), **Do Not Disturb**.
- Fixed and DND capture date, start time and end time; the client derives `durationMinutes` and `scheduledStartTime`.
- Every non-`TASK` type gets a constrained RRULE builder (`FREQ=DAILY|WEEKLY`, `BYDAY`, `UNTIL`).

### 2.4 Series: two kinds

- **Recurring fixed session** (non-`TASK` with an `rrule`): virtual.
  - One `SessionSeries` holds `rrule` + `exdates`; one representative `Session` anchors the first occurrence.
  - `SessionsService.list()` fans it out into occurrences with `id` `"<seriesId>::<startISO>"` (`expandRrule`, never materialized).
- **Multi-sitting `TASK`** (`sessionCount > 1`): materialized.
  - N real `Session` rows share one `seriesId` and `deadline`, each placed independently and spread across `now … deadline`.

Editing and deleting a series member:

| Call                                                | Effect                                                                  |
| --------------------------------------------------- | ----------------------------------------------------------------------- |
| `PATCH /sessions/:id` with `scope`, `skipConflicting` | `scope` is `occurrence` / `following` / `series`; `skipConflicting` optional |
| `DELETE /sessions/:id` on an occurrence id          | adds it to `exdates`                                                    |
| `DELETE /sessions/series/:id/truncate?from=<ISO>`   | pulls a recurring rrule's `UNTIL` back                                  |
| `DELETE /sessions/series/:id/from/:sessionId`       | drops a `TASK` sitting and every later one                              |
| `DELETE /sessions/series/:id`                       | drops the whole series                                                  |

### 2.5 A/B experiment

- `SlotProposal` holds what the experiment needs: `experimentId`, `randomizationSeed`, `primaryPolicy`, `observationCount`, `proposedStartTime` / `appliedStartTime`, `featureVector`, `selectedArm`. See [ab-testing.md](../scheduler/ab-testing.md).
- `SessionEvent` carries `dragDistanceMinutes` and `slotProposalId`.
- Both models' `sessionId` is nullable with `onDelete: SetNull`, so history survives a delete.
- `ExperimentService` writes a `SlotProposal` on every `TASK` scheduling event and assigns a 50/50 `primaryPolicy`: `HEURISTIC` (Policy A) or `LINUCB` (Policy B, via the Python bandit service).
- The delayed reward path (first `MOVE` / `RETAINED` → `/update` → `BanditArmState`) is live: see [ADR-0001](0001-linucb-model-design.md).

## 3. Consequences

- The migration is destructive: drops `SessionStatus`, `Session.status`, `Session.startTime`; rewrites `SessionEventType`.
- The dev DB is reset; there is no production database.
- `frontend/` (web PWA) and `mobile/` (Expo) are both clients of the `@zenflow/shared` contract; shared calendar logic lives in `@zenflow/core`.
- Ranking now lives in Python: see [ADR-0003](0003-python-authoritative-placement.md).
- Nest keeps a pure `backend/src/scheduler/core/*` (no I/O, clock or randomness) and an I/O `backend/src/scheduler/io/*`.
- Layout detail: [backend/README.md](../../backend/README.md).
