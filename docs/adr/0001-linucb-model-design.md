# ADR-0001: Disjoint LinUCB Model Design for Zenflow Scheduling

**Status:** Accepted
**Date:** 2026-08-29 · **Last updated:** 2026-09-07
**Decision:** Use per-student Disjoint LinUCB with reusable time-of-day arms.

Related: [`docs/scheduler/reranking.md`](../scheduler/reranking.md) (arm → timestamp
mapping), [`docs/scheduler/ab-testing.md`](../scheduler/ab-testing.md) (experiment),
[`docs/scheduler/heuristic.md`](../scheduler/heuristic.md) (the baseline scheduler,
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

Use **Disjoint LinUCB** with one model per student, five time-of-day arms, a context vector
shared across arms, ridge regularization (`λ = 1.0`), and online updates from the ADR-0002
move-or-keep signal.

| Arm             | Time range (local wall clock) |
| --------------- | ----------------------------- |
| `EARLY_MORNING` | `[00:00, 06:00)`              |
| `MORNING`       | `[06:00, 11:00)`              |
| `AFTERNOON`     | `[11:00, 17:00)`              |
| `EVENING`       | `[17:00, 20:00)`              |
| `NIGHT`         | `[20:00, 24:00)`              |

Boundaries are **half-open, lower-inclusive**: a session starting exactly at 17:00 is
`EVENING`. These five strings are the canonical arm identifiers for the API contract
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
model would create 35 arms and spread limited observations too thin. The design uses **5
time-of-day arms + day of week as context** for faster learning and better cold-start
behavior. Finer granularity can be added later if evaluation justifies it.

---

## 5. Context and feature vector

For each candidate day between `next_15min(now)` and the task deadline, Zenflow builds one
context vector `x` and scores it against each of the 5 arms:

```text
(task, candidate_day) → x  →  LinUCB scores all 5 arms  →  reranking.md maps to a timestamp
```

The arm is **not** duplicated in the context (disjoint LinUCB keeps a separate model per
arm). The vector is deliberately small — behavioral data is limited.

### 5.1 Feature vector (d = 46)

| Group         | Feature                        | Dims | Encoding / source                                                              |
| ------------- | ------------------------------ | ---- | ----------------------------------------------------------------------------- |
| session       | `remaining_days_until_deadline`| 1    | continuous, normalized (§5.2)                                                 |
| session       | `duration`                     | 1    | minutes (positive multiple of 15), normalized (§5.2)                         |
| user / day    | `day_preference_profile[24]`   | 24   | the candidate day's 24-hour row slice of `User.preferenceMatrix`, normalized |
| candidate day | `day_of_week`                  | 7    | one-hot, ISO weekday (Mon = index 0)                                          |
| candidate day | `candidate_days_from_now`      | 1    | whole days from today, normalized (§5.2)                                      |
| candidate day | `workload_by_type`             | 10   | for each `SessionType` {LECTURE, ASSIGNMENT, EXAM, TASK, DND}: (scheduled hours, session count) already placed on that day, normalized (§5.2) |
| candidate day | `semester_phase`               | 1    | fraction through the academic term from the DLU term calendar, `(now − term_start) / (term_end − term_start)` clamped to `[0, 1]`, then `·2 − 1`; `0` if no term calendar is available |
| —             | bias term                      | 1    | constant `1`                                                                 |

**Total `d = 46`.** This fixes the width of every stored vector: `BanditArmState.A`
(46 × 46), `BanditArmState.b` (46), `SlotProposal.featureVector` (46). Changing `d` is a
migration.

Deliberately excluded: tags (per-user, no global vocabulary — `Tag @@unique([userId, name])`);
a session `type` one-hot (constant — TASK-only scheduling); a separate exam / grade-risk
weight (no such field; the `workload_by_type` exam counts carry the exam signal for the
day); titles / notes (text dimensionality).

### 5.2 Normalization

All continuous features use **fixed-divisor min-max scaling to `[-1, 1]`, clamped** — no
running mean/variance, so the transform is stateless and reproducible.

| Feature                                              | Transform                                                       |
| --------------------------------------------------- | -------------------------------------------------------------- |
| `remaining_days_until_deadline`, `candidate_days_from_now` | `clamp(x / MAX_SCAN_DAYS, 0, 1) · 2 − 1`  (`MAX_SCAN_DAYS = 60`) |
| `duration`                                          | `clamp(minutes / 480, 0, 1) · 2 − 1`                            |
| `day_preference_profile[24]` (per cell)            | `clamp(cell, −1, 1)`  (cold-start values are in `[0, 1]`; nightly decay only shrinks magnitude) |
| `workload_by_type` hours / count (per entry)       | `clamp(hours / 12, 0, 1)`, `clamp(count / 8, 0, 1)`             |
| `semester_phase`                                    | already `[0, 1]` → `· 2 − 1`                                    |
| one-hot groups, bias                                | not normalized                                                  |

---

## 6. Cold start and per-student state

Each student starts with no observations. Every arm is initialized at the ridge prior:

```text
A = λI      (λ = 1.0)
b = 0
```

The uncertainty term `α·√(xᵀA⁻¹x)` encourages early exploration. As feedback arrives, each
student's arm models are updated independently.

```text
student
├── EARLY_MORNING → A, b
├── MORNING       → A, b
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
  A         Float[]        // d·d row-major, d = 46
  b         Float[]        // d
  version   Int            @default(0)  // optimistic-concurrency guard
  updatedAt DateTime       @updatedAt
  user      User           @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@id([userId, arm])
}
```

The Python bandit service (`services/bandit/`) is **stateless**: the NestJS backend loads
the 5 arms' `(A, b)` from this table, passes them in each `/predict` / `/update` payload,
and persists the `(A, b)` the service returns. Rows are lazily created at the ridge prior
on first use.

---

## 7. Reward

The reward is the ADR-0002 move-or-keep signal, against
`SessionEventType = CREATE | MOVE | RETAINED` (a resize is a `MOVE` with
`dragDistanceMinutes == 0`):

| Event      | Reward                                                                                          |
| ---------- | --------------------------------------------------------------------------------------------- |
| `RETAINED` | `+1` — the session's interval elapsed and it was never moved                                  |
| `MOVE`     | `−clamp(|dragDistanceMinutes| / D_SCALE, 0, 1)`  with `D_SCALE = 240` (min)                    |
| `MOVE`, resize only (`dragDistanceMinutes == 0`) | `0`                                                     |
| `CREATE`   | `0` — not an update; logged only                                                              |

The `MOVE` penalty is a linear ramp from `0` (no displacement) to `−1` (displaced ≥ 4 h),
clamped. `dragDistanceMinutes` is signed `(new − old start)`; the reward uses its magnitude,
measured from the model's *originally proposed* start
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

1. For each candidate day `d ∈ [next_15min(now), dl]`, build `x` (§5) and call `/predict`
   → `score(d, arm)` for all 5 arms.
2. Generate 15-minute-aligned candidate start times, filter to those that are **fully
   empty** and satisfy the hard constraints (§8.1).
3. Score each surviving slot in a single pass:
   `slot_score(c) = Σ_arm overlap_rate(c, arm) · score(day(c), arm) + slotPreferenceScore(c)`.
   `overlap_rate` is the fraction of `[c, c + duration)` inside that arm's band (a slot
   straddling local midnight is split there and each part scored against its own day). The
   `slotPreferenceScore` addend is the same overlap-weighted preference score Policy A uses
   (`docs/scheduler/heuristic.md`); it keeps slots meaningfully ordered before any arm has
   accumulated reward — a bandit arm with no data scores `0`.
4. Pick the highest `slot_score`; earliest start breaks ties.

Full detail and worked examples: [`reranking.md`](../scheduler/reranking.md). Existing
sessions are never moved to realize a better score — the mapping only ever places the new
session (or the one series member being placed).

### 8.1 Hard constraints

Applied only in step 2 (arm → concrete slot). LinUCB itself scores all 5 arms
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

| Parameter          | Value  | Notes                                                                                     |
| ------------------ | ------ | --------------------------------------------------------------------------------------- |
| ridge `λ`          | `1.0`  | `A = λI` at cold start; matches `services/bandit/src/models/linucb.py` default           |
| exploration `α`    | `0.15` | shipped default — stability over exploration; env-configurable; tune via offline replay |
| `D_SCALE`          | `240`  | minutes; `MOVE` penalty saturates at ≥ 4 h displacement                                  |
| `MAX_SCAN_DAYS`    | `60`   | candidate-day horizon and the deadline/day normalization divisor (`scheduler/constants.ts`); it feeds every stored feature vector, so changing it is a migration |

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

---

## 12. Decision summary

```text
context vector x (user × task × candidate day), d = 46
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
`backend/src/scheduler/core/*`; the `/predict` / `/update` calls, `SlotProposal` writes and
`BanditArmState` persistence live in `backend/src/scheduler/io/*` and `backend/src/bandit/*`.
