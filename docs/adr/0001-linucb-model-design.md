# ADR-0001: Disjoint LinUCB Model Design for Zenflow Scheduling

**Status:** Accepted
**Date:** 2026-08-29 · **Last updated:** 2026-09-21
**Decision:** Use per-student Disjoint LinUCB with reusable time-of-day arms.

Related: [`docs/scheduler/reranking.md`](../scheduler/reranking.md) (arm → timestamp
mapping), [`docs/scheduler/ab-testing.md`](../scheduler/ab-testing.md) (experiment),
[`services/bandit/README.md`](../../services/bandit/README.md) (the baseline scheduler,
Policy A), [ADR-0002](0002-scheduling-simplification.md) (the move-or-keep signal).

---

## 1. Context

Zenflow learns when each student prefers to do their flexible study work. Using every ISO
timestamp as an arm would create too many overly specific arms — knowledge from
`2026-09-14T09:00` would not transfer to `2026-09-15T09:00`. The model needs reusable arms
that represent meaningful time preferences, work across dates, learn from limited data, and
keep per-student state small.

Only `TASK` sessions are engine-scheduled (ADR-0002 §2.2). `ASSIGNMENT` / `EXAM` /
`LECTURE` / `DND` are user-pinned and never auto-placed, so LinUCB only ever scores
contexts for a `TASK` — including each member of a `sessionCount > 1` `TASK` series.

---

## 2. Decision

Use **Disjoint LinUCB** with one model per student, six time-of-day arms, a context vector
shared across arms, ridge regularization (`λ = 1.0`), and online updates from the ADR-0002
move-or-keep signal.

| Arm             | Time range (local wall clock) |
| --------------- | ----------------------------- |
| `EARLY_MORNING` | `[00:00, 06:00)`              |
| `MORNING`       | `[06:00, 11:00)`              |
| `MIDDAY`        | `[11:00, 14:00)`              |
| `AFTERNOON`     | `[14:00, 17:00)`              |
| `EVENING`       | `[17:00, 20:00)`              |
| `NIGHT`         | `[20:00, 24:00)`              |

Boundaries are **half-open, lower-inclusive**: a session starting exactly at 17:00 is
`EVENING`. These six strings are the canonical arm identifiers for the API contract
(`SchedulingArm` in `@zenflow/shared`).

LinUCB scores each `(candidate_day, arm)` pair; the scheduler then maps the scores to a
concrete feasible timestamp — see [`reranking.md`](../scheduler/reranking.md).

---

## 3. Why Disjoint LinUCB?

The hypothesis: **a student's preferred time depends on the scheduling context** — an
ordinary assignment lands in the afternoon, exam prep in the evening, an urgent deadline
earlier in the day. A static preference matrix cannot represent that. Disjoint LinUCB gives
each arm its own context-dependent reward model without assuming all time periods behave
identically.

---

## 4. Why not timestamp or 35-arm models?

ISO timestamps are too specific and create a large arm space. A day-of-week × time-of-day
model would create 35 arms and spread limited observations too thin. The design uses **6
time-of-day arms + weekend as context** for faster learning and better cold-start
behavior. Finer granularity can be added later if evaluation justifies it.

---

## 5. Context and feature vector

For each candidate day between `next_15min(now)` and the task deadline, Zenflow builds one
context vector `x` and scores it against each of the 6 arms:

```text
(task, candidate_day) → x  →  LinUCB scores all 6 arms  →  reranking.md maps to a timestamp
```

The arm is **not** duplicated in the context (disjoint LinUCB keeps a separate model per
arm). The vector is deliberately small — behavioral data is limited.

### 5.1 Feature vector (d = 7)

| # | Feature                         | Encoding                                  |
| - | ------------------------------- | ----------------------------------------- |
| 0 | `remaining_days_until_deadline` | `clamp(x / 60, 0, 1) · 2 − 1`             |
| 1 | `duration` (minutes)            | `clamp(x / 480, 0, 1) · 2 − 1`            |
| 2 | `candidate_days_from_now`       | `clamp(x / 60, 0, 1) · 2 − 1`             |
| 3 | `is_weekend` (ISO 6/7)          | `+1` / `−1`                               |
| 4 | fixed load: LECTURE + EXAM + DND hours on the day | `clamp(h / 12, 0, 1)`   |
| 5 | flexible load: TASK + ASSIGNMENT hours on the day | `clamp(h / 12, 0, 1)`   |
| 6 | bias                            | `1`                                       |

- Fixed divisors, no running stats: stateless and reproducible. `60` = `MAX_SCAN_DAYS`.
- `is_weekend` is signed so `‖x‖`, and with it the exploration bonus, is the same on every day.
- `d` fixes the width of `BanditArmState.A` (d×d), `.b` and `SlotProposal.featureVector`.
  Changing it means resetting arm state and bumping `BANDIT_MODEL_VERSION`.
- The preference matrix is never an input.
- Excluded: tags (per-user vocabulary), session type (always TASK), titles/notes,
  `semester_phase` (always 0), weekday one-hots (collinear with the bias), and per-type
  hours/counts beyond the two workload buckets in rows 4-5 (overlapping, mostly 0).
- `d = 7`; stored state at a different `d` must be cleared before deploy
  (`BANDIT_MODEL_VERSION = "linucb-d7-v0"`, `FEATURE_DIM` in `@zenflow/shared`).

---

## 6. Cold start and per-student state

Each student starts with no observations. Every arm is initialized at the ridge prior:

```text
A = λI      (λ = 1.0)
b = 0
```

A cold arm scores its exploration bonus `α·√(xᵀx/λ)`, never a fixed `0`, so an arm whose
placements get moved falls below the untried ones. At full cold start (every arm untried),
ties break on a seeded band order with `EARLY_MORNING` last (the same `TIE_BREAK_ARM_ORDER`
used in §8's tie-break rule). As feedback arrives, each student's arm models are updated
independently.

```text
student
├── EARLY_MORNING → A, b
├── MORNING       → A, b
├── MIDDAY        → A, b
├── AFTERNOON     → A, b
├── EVENING       → A, b
└── NIGHT         → A, b
```

### 6.1 Persistence

Per-student, per-arm `(A, b)` lives in a **dedicated Postgres table in the existing Prisma
database** — not pgvector, not a separate instance (`(A, b)` is never queried by similarity).

```prisma
model BanditArmState {
  userId    String
  arm       SchedulingArm
  A         Float[]        // d·d row-major, d = 7
  b         Float[]        // d
  version   Int            @default(0)  // optimistic-concurrency guard
  updatedAt DateTime       @updatedAt
  user      User           @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@id([userId, arm])
}
```

The Python bandit service (`services/bandit/`) is **stateless**: the NestJS backend loads
the 6 arms' `(A, b)` from this table, passes them in each `/v1/place` / `/v1/update` payload,
and persists the `(A, b)` the service returns. Rows are lazily created at the ridge prior
on first use.

---

## 7. Reward

The reward is the ADR-0002 move-or-keep signal, against
`SessionEventType = CREATE | MOVE | RETAINED` (a resize is a `MOVE` with
`dragDistanceMinutes == 0`):

| Event                          | Reward                                          |
| ------------------------------ | ----------------------------------------------- |
| `RETAINED`                     | `+1`: elapsed and never moved                   |
| `MOVE`                         | `−min(1, abs(dragDistanceMinutes) / D_SCALE)`   |
| `MOVE`, resize only (drag = 0) | `0`                                             |
| `CREATE`                       | `0`: logged only, no update                     |

The `MOVE` penalty is a linear ramp from `0` (no displacement) to `−1` (displaced ≥ 4 h),
clamped. `dragDistanceMinutes` is signed `(new − old start)`; the reward uses its magnitude,
measured from the model's _originally proposed_ start
(`SlotProposal.proposedStartTime`, equal to `oldSnapshot.scheduledStartTime` on the first
move). Only the **first** `MOVE` after a proposal produces a bandit update; subsequent
moves are logged but not re-applied, so nudging a session repeatedly does not compound the
penalty.

👍 / 👎 feedback is **not** a reward — it is an evaluation-only signal
([`ab-testing.md`](../scheduler/ab-testing.md) §4).

---

## 8. Query flow and arm → timestamp mapping

LinUCB is queried **once per candidate day**, not per 15-minute slot. For a `TASK` with
deadline `dl`:

1. For each candidate day `d ∈ [next_15min(now), dl]`, build `x` (§5) and score all 6 arms
   in-process (`/v1/place`, ADR-0003) → `score(d, arm)`.
2. Score every feasible 15-minute start on every candidate day in one scan (not "arm, then
   minute inside it"): starts include one overhanging local midnight (e.g. 23:45); the
   deadline caps the slot's _end_ and need not itself be slot-aligned. Filter to those that
   are **fully empty** and satisfy the hard constraints (§8.1).
3. Score each surviving slot in a single pass:

   ```text
   score(c) = wL · Σ_arm overlap_rate(c, arm) · score(day(c), arm)
            + wP · slotPreferenceScore(c) / durationHours
            + STABILITY_WEIGHT · stabilityScore(prevStart, c)
   ```

   - `overlap_rate(c, arm)` is the fraction of `[c, c + duration)` inside that arm's band (a
     slot straddling local midnight is split there and each part scored against its own
     day); arm/hour overlap uses per-day wall-clock offsets (exact on 24 h days; DST days
     use the Intl-based `overlapRate`).
   - `selectedArm` (the arm a delayed `/update` reward is credited to) is the arm containing
     the slot's start, not a weighted blend across arms.
   - `slotPreferenceScore` is the same overlap-weighted preference score Policy A uses
     (`services/bandit/README.md`); it keeps slots meaningfully ordered before any arm has
     accumulated reward — a bandit arm with no data scores `0`.
   - **Adaptive weights** `(wL, wP) = adaptiveWeights(observationCount)`
     (`core/adaptive-weights.ts`, constants in `constants.ts`): cold `wP = 1, wL = 0.3`; warm
     `wP = 0.1, wL = 1`; linear over `WEIGHT_WARMUP_OBSERVATIONS = 40` reward events (user
     `MOVE` + `RETAINED`; `SYSTEM_MOVE` never counts). Applied weights are stored on
     `SlotProposal.linucbWeight` / `.stabilityWeight`. The heuristic stays preference-only
     (no arm term), so the A/B keeps two distinct policies.
   - Exact ties break by `TIE_BREAK_ARM_ORDER` (MORNING, AFTERNOON, EVENING, EARLY_MORNING,
     NIGHT) on the start's arm, then earliest start — deterministic, never favors 00:00.
4. Pick the highest score; earliest start breaks any remaining ties.

Full detail and worked examples: [`reranking.md`](../scheduler/reranking.md). Existing
sessions are never moved to realize a better score outside of displacement (§11) — the
mapping only ever places the new session (or the one series member being placed).
`MAX_SCAN_DAYS` stays 60 (it normalizes the context vector); single-task placement scans at
most `SCAN_CAP_DAYS = 30` days, loading all day loads for the range in one query.

### 8.1 Hard constraints

Applied only in step 2 (arm → concrete slot). LinUCB itself scores all 6 arms
unconstrained.

1. `start ≥ next_15min(now)`
2. `start + duration ≤ deadline`
3. 15-minute grid alignment
4. no overlap with `occupied`: fixed sessions (`ASSIGNMENT` / `EXAM` / `LECTURE`),
   standalone `DND`, recurring `DND` occurrences (`expandRrule`), other already-placed
   `TASK`s, and — for a series member — its already-placed siblings
5. the slot is fully empty (no partial-overlap placement)

A slot may run past local midnight up to the deadline (matching Policy A); there is no
same-day constraint.

---

## 9. Delayed-feedback bookkeeping

The reward for a proposal arrives minutes to days later (a `MOVE` drag, or the half-hourly
`RETAINED` sweep). The pending `(arm, context, proposed time)` lives on `SlotProposal`:

- `SlotProposal.featureVector Float[]` — the length-`d` context `x` for the selected day.
- `SlotProposal.selectedArm SchedulingArm` — the arm behind the chosen slot.
- `SessionEvent.slotProposalId String?` — FK so a `MOVE` / `RETAINED` can find its
  originating proposal (a proposal without a later event is simply never used for an update).

Lifecycle: when the first `MOVE` or the `RETAINED` sweep fires for a session whose
`SlotProposal.primaryPolicy == LINUCB`, the backend computes the §7 reward, calls `/update`
with `(selectedArm, featureVector, reward, A, b)`, persists the returned `(A, b)`, and
stamps the proposal consumed (`observationCount++`).

---

## 10. Parameters

| Parameter       | Value  | Notes                                                                                                                                                            |
| --------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ridge `λ`       | `1.0`  | `A = λI` at cold start; matches `services/bandit/src/models/linucb.py` default                                                                                   |
| exploration `α` | `0.15` | shipped default — stability over exploration; env-configurable; tune via offline replay                                                                          |
| `D_SCALE`       | `240`  | minutes; `MOVE` penalty saturates at ≥ 4 h displacement                                                                                                          |
| `MAX_SCAN_DAYS` | `60`   | candidate-day horizon and the deadline/day normalization divisor (`scheduler/constants.ts`); it feeds every stored feature vector, so changing it is a migration |

Optional stability follow-up (not shipped): warm-start `θ` for each arm from the user's
`preferenceMatrix` band means instead of `b = 0`, so a brand-new user does not explore
`EARLY_MORNING` as if it were neutral.

---

## 11. A/B integration

LinUCB (Policy B) is compared against the preference heuristic (Policy A) under the same
hard constraints and the same slot-scoring pass (§8). Both policies place **only the
current session (or series member), into an empty slot**, and never repack other sessions
except through displacement (below). The stability constraint (empty-slot-only outside that
exception) is shared, so neither policy needs a separate move-cost term. `ExperimentService`
assigns one 50/50 `primaryPolicy` roll and one independent pairwise-sample roll per
scheduling event; for a `sessionCount > 1` `TASK` series, both rolls are made **once for the
whole series** (every sitting shares the primary policy), with each member still placed
within its own `± max(1, floor(X/N))`-day window around its even-spread target (`X` = whole
days to deadline, `N` = member count). On a pairwise hit the placement service computes two
complete series plans — all-heuristic and all-LinUCB, each with its own sibling ledger — and
each sitting's `SlotProposal` pairs its pick in the applied plan with its pick in the other
plan (ADR-0003 §3.2). One `SlotProposal` per member is recorded either way. See
[`ab-testing.md`](../scheduler/ab-testing.md).

**Displacement.** The empty-slot-only stance is relaxed only when a `TASK` has no free slot
before its deadline: `core/displacement.ts` repacks standalone flexible tasks on the deadline
day (widening to ±1 day) in earliest-deadline-first order, capped at `MAX_DISPLACED_TASKS`,
minimizing moves. Fixed blocks and series sittings never move. These scheduler-initiated
moves are `SYSTEM_MOVE` events (reward `0`): no bandit update, no preference change. If still
infeasible the API returns `409 SCHEDULE_INFEASIBLE`, and the client retries with
`infeasiblePolicy: "ACCEPT_CONFLICTS" | "ACCEPT_LATE_DEADLINE"`.

---

## 12. Decision summary

```text
context vector x (user × task × candidate day), d = 7
    ↓
5 half-open time-of-day arms, Disjoint LinUCB (λ = 1.0, α = 0.15)
    ↓
per-day (day, arm) scores
    ↓
single-pass slot scoring: Σ overlap·arm-score + slotPreferenceScore, empty slots only,
earliest-start tie-break
    ↓
concrete timestamp + SlotProposal (featureVector, selectedArm)
    ↓
delayed reward: MOVE (graded, first move only) / RETAINED (+1) → /update → BanditArmState
```

The design prioritizes simple state, reusable arms, fast personalization, schedule
stability, and a focused evaluation. Pure scoring math lives in
`backend/src/scheduler/core/*`; the `/v1/place` / `/v1/update` calls, `SlotProposal` writes and
`BanditArmState` persistence live in `backend/src/scheduler/io/*` and `backend/src/bandit/*`.
