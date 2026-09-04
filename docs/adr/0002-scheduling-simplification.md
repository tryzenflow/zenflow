# ADR-0002: Scheduling & Session-Model Simplification

**Status:** Accepted
**Date:** 2026-08-30
**Supersedes:** the completion/abandonment lifecycle and the manual "Optimize" surface.

---

## 1. Context

The session model had accreted a full completion lifecycle (`SessionStatus`
`PENDING | DONE | ABANDONED`, `COMPLETE` / `ABANDON` / `KEEP` events, an hourly overdue
sweep) on top of a scheduler engine that had already been reduced to a single pure
heuristic. The completion states carried little signal — a student rarely marks work done —
while adding UI (checkmarks, "Mark done", strikethrough) and telemetry surface.

## 2. Decision

### 2.1 Move-or-keep, no completion

A scheduled session has exactly two outcomes:

- **Move** — the user drags or resizes it. `SessionsService.update` writes a `MOVE`
  `SessionEvent` (`rewardScore = -1`, `dragDistanceMinutes` signed) and stamps
  `Session.lastMovedAt`.
- **Keep** — the session's interval elapses and it was never moved. The half-hourly
  `RetainedSessionsService` sweep writes a `RETAINED` `SessionEvent` (`rewardScore = +1`)
  and stamps `Session.retainedAt` (idempotency). It replaces the deleted
  `AbandonedSessionsService`.

`SessionEventType` is now `CREATE | MOVE | RETAINED`. `SessionStatus`, `Session.status`,
`Session.startTime`, and the `OVERDUE` notification topic are removed.

### 2.2 Session types

`SessionType = TASK | ASSIGNMENT | EXAM | LECTURE | DND`:

| Type | Deadline | Scheduled by | Recurrence | Draggable |
| --- | --- | --- | --- | --- |
| `TASK` | required | the engine (implicit day repack) | no | yes |
| `ASSIGNMENT` / `EXAM` / `LECTURE` | none | the user pins `scheduledStartTime` | no | no |
| `DND` | none | the user pins `scheduledStartTime` | optional `rrule` | no |

`Session.deadline` is now nullable. Fixed types and DND blocks are hard `occupied` intervals
the day repack schedules around; they are never auto-moved.

### 2.3 Manual creation via a 3-tab form

`mobile/`'s create screen gains a `SessionTypeTabs` selector: **Task** (default) / **Fixed**
(with an Assignment·Exam·Lecture segment) / **Do Not Disturb**. Fixed/DND capture
date + start-time + end-time; the client derives `durationMinutes` and the concrete
`scheduledStartTime`. DND adds a constrained RRULE builder
(`FREQ=DAILY|WEEKLY`, `INTERVAL`, `BYDAY`, `UNTIL`).

### 2.4 Recurring DND

A recurring DND block is one `SessionSeries` (`type: DND`, `deadline: null`, `rrule`) plus a
single representative `Session` at the first occurrence. Occurrences are expanded at read
time via `backend/src/scheduler/utils/recurrence.ts` (`expandRrule`, wrapping the `rrule`
package) — never materialized. `SessionsService.list` emits per-occurrence virtual rows
(`id = "<seriesId>::<iso>"`); `DayRescheduleService` folds occurrences into `occupied`.

### 2.5 A/B testing — schema readiness only

`SlotProposal` is reshaped to hold everything `docs/scheduler/ab-testing.md` needs
(`experimentId`, `randomizationSeed`, `primaryPolicy`, `observationCount`,
`proposedStartTime` / `appliedStartTime`, `firstModifiedAt` / `acceptedWithoutModification`,
pairwise + `feedback` columns). `SessionEvent` gains `dragDistanceMinutes` + `policy`, and
both models' `sessionId` becomes nullable with `onDelete: SetNull` so history survives a
delete. **Nothing writes `SlotProposal` yet** — the `ExperimentService`, the 50/50
randomizer, the pairwise / like-dislike UI, and the `preferenceMatrix` learning writer are a
later phase, now unblocked by the LinUCB spec reconciliation (2026-08-31) — see
`docs/adr/0001-linucb-model-design.md` (§5 feature vector, §7 reward, §9 delayed feedback,
§11 A/B) and `docs/scheduler/ab-testing.md`.

### 2.6 Frontend archived

The web PWA (`frontend/`) is dropped from the pnpm workspace. All UI lives in `mobile/`.

## 3. Consequences

- The migration is destructive (drops `SessionStatus`, `Session.status`, `Session.startTime`,
  rewrites `SessionEventType`). Dev DB is reset; there is no production database.
- `docs/scheduler/reranking.md` / `services/bandit/linucb.md` were rewritten (2026-08-31)
  against the current `heuristic.ts` / `day-reschedule.service.ts`; the re-ranker seam,
  `BANDIT_SERVICE_URL`, and the per-day bandit call still need to be built (tracked in
  `services/bandit/README.md`).

> **Addendum (2026-08-31).** The implicit **day repack** described in §2.2 / §2.4 is
> withdrawn. `DayRescheduleService` is deleted; `HeuristicScheduleService` (`scheduleTask`
> / `scheduleSeries`) places **only** the session being created or deadline-edited and
> never moves another session (`docs/scheduler/reranking.md`, `docs/scheduler/heuristic.md`).
> `SessionSeries` now also backs `TASK` series (`POST /sessions` `sessionCount > 1`,
> nullable `rrule`); `DND` occurrences are still folded into `occupied` by `day-load.ts`.

> **Addendum (2026-09-01).** Reorg only, no behavior change to this ADR's model: the
> placement services were renamed and split — `HeuristicScheduleService` →
> `scheduler/io/heuristic-placer.service.ts` (`HeuristicPlacer`, `placeTask` /
> `placeInWindow`); `BanditScheduleService` → `scheduler/io/bandit-placer.service.ts`
> (`BanditPlacer`); series placement moved to `scheduler/io/series-placer.service.ts`
> (`SeriesPlacer`); `SessionsService` now calls one facade,
> `scheduler/io/task-placement.service.ts` (`TaskPlacementService`), plus
> `SchedulingFeedbackService` for the first-move reward. Pure math lives in
> `scheduler/core/*`. `TASK`-series members now go through the A/B path (see the ADR-0001
> addendum).
