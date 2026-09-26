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
- Excluded: tags (per-user vocabulary), session type (always TASK), titles/notes.
- History: d = 46 → 22 (dropped the unused preference slots). 22 → 7 on 2026-09-23 (§14).

---

## 6. Cold start and per-student state

Each student starts with no observations. Every arm is initialized at the ridge prior:

```text
A = λI      (λ = 1.0)
b = 0
```

A cold arm scores its exploration bonus `α·√(xᵀx/λ)`, never a fixed `0`, so an arm whose
placements get moved falls below the untried ones. As feedback arrives, each
student's arm models are updated independently.

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
2. Generate 15-minute-aligned candidate start times, filter to those that are **fully
   empty** and satisfy the hard constraints (§8.1).
3. Score each surviving slot in a single pass:
   `slot_score(c) = Σ_arm overlap_rate(c, arm) · score(day(c), arm) + slotPreferenceScore(c)`.
   `overlap_rate` is the fraction of `[c, c + duration)` inside that arm's band (a slot
   straddling local midnight is split there and each part scored against its own day). The
   `slotPreferenceScore` addend is the same overlap-weighted preference score Policy A uses
   (`services/bandit/README.md`); it keeps slots meaningfully ordered before any arm has
   accumulated reward — a bandit arm with no data scores `0`.
4. Pick the highest `slot_score`; earliest start breaks ties.

Full detail and worked examples: [`reranking.md`](../scheduler/reranking.md). Existing
sessions are never moved to realize a better score — the mapping only ever places the new
session (or the one series member being placed).

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
current session (or series member), into an empty slot**, and never repack other sessions.
The stability constraint (empty-slot-only, no displacement) is shared, so neither policy
needs a move-cost term. `ExperimentService` assigns a 50/50 `primaryPolicy` per scheduling
event and records one `SlotProposal`; a `sessionCount > 1` `TASK` series runs the same
50/50 pick per member (each within a `± max(1, floor(X/N))`-day window around its
even-spread target, `X` = whole days to deadline, `N` = member count), one `SlotProposal`
per member. See [`ab-testing.md`](../scheduler/ab-testing.md).

*Amended by #58:* a series now takes **one** 50/50 roll and **one** pairwise roll for the whole
series (every sitting shares the primary policy). On a pairwise hit the placement service
computes two complete series plans -- all-heuristic and all-LinUCB, each with its own sibling
ledger -- and each sitting's `SlotProposal` pairs its pick in the applied plan with its pick in
the other plan (ADR-0003 §3.2 amendment). One `SlotProposal` per member is still recorded.

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

---

## 13. Addendum (2026-09-21, issue #62): slot-first scoring and adaptive weights

Supersedes §8's "arm, then minute" pick (Item 3B2). There is no separate ADR for #62; this
addendum is the decision record.

**Problem.** With an untrained bandit every arm scores 0. The small preference nudge
(`PREFERENCE_NUDGE_WEIGHT = 0.1`) only ranked minutes inside an arm chosen by ARM_BANDS order, so a
new user was proposed 00:00 (EARLY_MORNING first). A bigger nudge would make LinUCB irrelevant.

**Decision.**

1. `core/linucb-best-slot.ts` scores every feasible 15-min start on every candidate day and ranks
   across days. Starts include 23:45 overhanging midnight; the deadline caps the _end_ and need not
   be slot-aligned.

   ```text
   score = wL * SUM_arm overlapRate(slot, arm) * armScore[day][arm]
         + wP * slotPreferenceScore(slot) / durationHours
         + STABILITY_WEIGHT * stabilityScore(prevStart, slot)
   ```

   - `armScore[day]` is the arm's LinUCB score for the day the slot starts on.
   - `selectedArm` (the arm a delayed `/update` reward is credited to) stays the arm containing the start.
   - Arm/hour overlap uses per-day wall-clock offsets (exact on 24h days; DST days use the Intl `overlapRate`).

2. **Adaptive weights** `(wL, wP) = adaptiveWeights(observationCount)` (`core/adaptive-weights.ts`,
   constants in `constants.ts`). Cold: `wP = 1, wL = 0.3`. Warm: `wP = 0.1, wL = 1`. Linear over
   `WEIGHT_WARMUP_OBSERVATIONS = 40` reward events (user `MOVE` + `RETAINED`; `SYSTEM_MOVE` never
   counts). Applied weights are stored on `SlotProposal.linucbWeight` / `.stabilityWeight` (was `.preferenceWeight` before the pref term was dropped). The
   heuristic stays preference-only (no arm term), so the A/B keeps two distinct policies.
3. **Exact ties**: `TIE_BREAK_ARM_ORDER` (MORNING, AFTERNOON, EVENING, EARLY_MORNING, NIGHT) on the
   start's arm, then earlier start. Deterministic, never favours 00:00.
4. `PREFERENCE_NUDGE_WEIGHT` is unused by the scan (deleted 2026-09-23). The `/update`
   contract is unchanged.
5. `MAX_SCAN_DAYS` stays 60 (it normalizes the context vector). Single-task placement scans at most
   `SCAN_CAP_DAYS = 30` days. One range query loads all day loads for a scan.

**Displacement (issue #62 B).** §11's "no displacement" stance is relaxed only when a `TASK` has no
free slot before its deadline.

- `core/displacement.ts` repacks standalone flexible tasks on the deadline day (widening to +/-1 day)
  in earliest-deadline-first order, capped at `MAX_DISPLACED_TASKS`, minimizing moves. Fixed blocks
  and series sittings never move.
- Scheduler moves are `SYSTEM_MOVE` events (reward 0): no bandit update, no preference change.
- If still infeasible the API returns `409 SCHEDULE_INFEASIBLE`. The client retries with
  `infeasiblePolicy: "ACCEPT_CONFLICTS" | "ACCEPT_LATE_DEADLINE"`.

---

## 14. Addendum (2026-09-23): fast learning for MVP verification

Replaces §5.1's d = 22, the "cold arm scores 0" rule, and the preference-matrix in-band tie-break.

- **Cold arm = ridge prior.** Every untried arm scores `α·√(xᵀx/λ)`.
  - Before: a cold arm was pinned at `0`. The first arm to be rewarded won forever, even when its
    placements were moved.
  - At full cold start the seeded band order still breaks the tie, with EARLY_MORNING last.
- **d = 22 → 7** (§5.1).
  - Dropped: `semester_phase` (always 0), the weekday one-hots (collinear with the bias), and
    per-type hours and counts (overlapping, mostly 0).
  - Stored d = 22 arm state must be cleared before deploy (`BANDIT_MODEL_VERSION = "linucb-d7-v0"`).
  - Delayed rewards for d = 22 proposals are dropped (`FEATURE_DIM` in `@zenflow/shared`).
- **No preference matrix in LinUCB.** Inside the winning band, the start closest to the band's
  centre wins: a fixed rule that learns nothing. This keeps the A/B as pure LinUCB vs the pure
  heuristic.
- **Evidence:** `services/bandit/tests/test_learning.py` runs the real place → reward → update loop
  against simulated users.
  - A fixed band is found in ≤ 5 placements and then held.
  - A weekday/weekend split is learned by the 3rd weekend.
- **AFTERNOON [11:00, 17:00) split into MIDDAY [11:00, 14:00) + AFTERNOON [14:00, 17:00).**
  Each task goes to its band's centre, so a 6 h band could only offer 13:30. The split adds one
  exploration step for a new user (a fixed band is now found in ≤ 5 placements).
- **Deferred until prod data points to them:** hybrid LinUCB, a matrix-seeded prior.
