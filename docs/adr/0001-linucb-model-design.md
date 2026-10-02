# ADR-0001: Disjoint LinUCB Model Design for Zenflow Scheduling

**Status:** Accepted
**Date:** 2026-08-29 · **Last updated:** 2026-09-28
**Issue:** none (predates issue-tracked ADRs for this project)

Full algorithm detail and worked examples live in
[`docs/scheduler/reranking.md`](../scheduler/reranking.md) and
[`services/bandit/README.md`](../../services/bandit/README.md) — this record captures the
decision and why, not the implementation.

## Context

- Zenflow learns when each student prefers to do their flexible study work, so it can
  personalize where a `TASK` lands instead of always taking the same free slot.
- Using every ISO timestamp as an arm would create far too many overly specific arms —
  knowledge from one Monday 9am wouldn't transfer to the next.
- The model needs reusable arms that represent meaningful time preferences, work across
  dates, learn from limited data, and keep per-student state small.
- Only `TASK` sessions are engine-scheduled — fixed types (`ASSIGNMENT`/`EXAM`/`LECTURE`/`DND`)
  are user-pinned and never auto-placed, so this model only ever scores a `TASK` (including
  each sitting of a multi-session series).

## Decision

- **Disjoint LinUCB**: one ridge-regression model per student per arm (`λ = 1.0`,
  `α = 0.15`), rather than one shared model — a student's preferred time depends on context
  (an ordinary assignment vs. exam prep vs. an urgent deadline), which a single static model
  or preference matrix can't represent.
- **Six half-open, lower-inclusive time-of-day arms**, the canonical `SchedulingArm` values in
  `@zenflow/shared`:

  | Arm | Time range (local wall clock) |
  | --- | --- |
  | `EARLY_MORNING` | `[00:00, 06:00)` |
  | `MORNING` | `[06:00, 11:00)` |
  | `MIDDAY` | `[11:00, 14:00)` |
  | `AFTERNOON` | `[14:00, 17:00)` |
  | `EVENING` | `[17:00, 20:00)` |
  | `NIGHT` | `[20:00, 24:00)` |

- **Small context vector (`d = 7`)**, shared across arms, built once per candidate day —
  deadline proximity, duration, days-from-now, weekend flag, fixed/flexible day load, bias.
  Full encoding: `services/bandit/README.md`.
- **Cold start**: every arm begins at the ridge prior (`A = λI`, `b = 0`) and scores its
  exploration bonus rather than a flat `0`, so an untried arm isn't penalized relative to one
  that's already been moved away from.
- **Reward = the move-or-keep signal** from [ADR-0002](0002-scheduling-simplification.md): a
  kept session scores `+1`, a moved one scores a graded penalty by drag distance. Full reward
  table: `services/bandit/README.md`.
- **A/B'd against the preference heuristic** (Policy A) under the same hard constraints and
  slot-scoring pass, so neither policy gets a placement advantage from a different mechanism —
  see `docs/scheduler/ab-testing.md`.

### Alternatives rejected

- **Per-ISO-timestamp arms**: too sparse, no transfer between dates.
- **Day-of-week × time-of-day (35 arms)**: spreads limited observations too thin and slows
  cold-start learning versus the shipped 6-arm design.

## API / data model changes

- `SchedulingArm` (the 6 arm strings) and `FEATURE_DIM` (`d = 7`) are exported from
  `@zenflow/shared` as the model's wire contract.
- `BanditArmState` (Prisma): per-`(userId, arm)` row holding `A`/`b` (flattened floats) plus an
  optimistic-concurrency `version`. The Python service is stateless — Nest loads/persists this
  table around every `/v1/place` and `/v1/update` call.
- `SlotProposal.featureVector` / `.selectedArm` record the context and arm a placement was
  scored against, so a later `MOVE`/`RETAINED` event can credit the right arm.

## Consequences

- **Good:** small, reproducible per-student state; fast personalization; schedules stay stable
  (LinUCB only ever proposes a slot for the session being placed, never moves another one,
  aside from the displacement path in ADR-0003); one mapping layer serves both A/B policies.
- **Costs:** six arms is a coarser signal than a truly personalized model would give; adding
  finer granularity later means a state reset and a `BANDIT_MODEL_VERSION` bump.
- **Superseded:** an early adaptive-weight blend (mixing the arm score with the preference-
  heuristic score, ramped by observation count) was replaced by the shipped slot-first scan
  (issue #62A) — LinUCB's applied score is now the arm term plus a proximity-scaled stability
  term only, with no preference-matrix blend, so the two A/B policies stay fully independent.
  See `services/bandit/README.md` for the shipped formula.
- **Follow-up (not shipped):** warm-starting a new user's arms from their `preferenceMatrix`
  instead of `b = 0`, so a brand-new user doesn't explore `EARLY_MORNING` as if neutral.
