# ADR-0001: Disjoint LinUCB Model Design for Zenflow Scheduling

**Status:** Accepted; the arm table is superseded by [ADR-0012](0012-linucb-time-of-day-arms.md)
**Date:** 2026-08-29 · **Last updated:** 2026-09-23
**Decision:** Per-student Disjoint LinUCB with reusable time-of-day arms.

Related:
- [reranking.md](../scheduler/reranking.md): arm to timestamp mapping.
- [ab-testing.md](../scheduler/ab-testing.md): the experiment.
- [services/bandit/README.md](../../services/bandit/README.md): implementation and Policy A (heuristic baseline).
- [ADR-0002](0002-scheduling-simplification.md): the move-or-keep signal.
- [ADR-0003](0003-python-authoritative-placement.md): scoring runs in Python.

## 1. Context

- Zenflow learns when each student prefers to do flexible study work.
- An arm per ISO timestamp is too specific: `2026-09-14T09:00` teaches nothing about `2026-09-15T09:00`.
- Arms must be reusable across dates, learn from little data and keep per-student state small.
- Only `TASK` sessions are engine-scheduled (ADR-0002 §2.2), including each member of a `sessionCount > 1` series.
- `ASSIGNMENT` / `EXAM` / `LECTURE` / `DND` are user-pinned and never scored.

## 2. Decision

One Disjoint LinUCB model per student: six time-of-day arms, one shared context vector, ridge `λ = 1.0`, online updates from the move-or-keep signal.

| Arm             | Local wall clock |
| --------------- | ---------------- |
| `EARLY_MORNING` | `[00:00, 08:00)` |
| `MORNING`       | `[08:00, 12:00)` |
| `MIDDAY`        | `[12:00, 14:00)` |
| `AFTERNOON`     | `[14:00, 18:00)` |
| `EVENING`       | `[18:00, 22:00)` |
| `NIGHT`         | `[22:00, 24:00)` |

- Boundaries are half-open, lower-inclusive: a session starting at 17:00 is `EVENING`.
- The six strings are the API identifiers (`SchedulingArm` in `@zenflow/shared`).
- LinUCB scores each `(candidate_day, arm)`; the scheduler maps scores to a feasible timestamp (§8).

## 3. Why Disjoint LinUCB

- Hypothesis: preferred time depends on context (ordinary assignment in the afternoon, exam prep in the evening, urgent work earlier).
- A static preference matrix cannot express that.
- Disjoint LinUCB gives each arm its own context-dependent reward model.

## 4. Why not timestamp or 35-arm models

- ISO timestamps: huge arm space.
- Day-of-week x time-of-day: 35 arms spread thin data.
- Chosen: 6 arms plus weekend as context, for faster learning and better cold start.
- Finer arms only if evaluation justifies it.

## 5. Context and feature vector

For each candidate day between `next_15min(now)` and the deadline, build one `x` and score it against all 6 arms.
The arm is not in `x` (disjoint LinUCB keeps one model per arm).

### 5.1 Feature vector (d = 7)

| # | Feature                                           | Encoding                       |
| - | ------------------------------------------------- | ------------------------------ |
| 0 | `remaining_days_until_deadline`                   | `clamp(x / 60, 0, 1) · 2 − 1`  |
| 1 | `duration` (minutes)                              | `clamp(x / 480, 0, 1) · 2 − 1` |
| 2 | `candidate_days_from_now`                         | `clamp(x / 60, 0, 1) · 2 − 1`  |
| 3 | `is_weekend` (ISO 6/7)                            | `+1` / `−1`                    |
| 4 | fixed load: LECTURE + EXAM + DND hours on the day | `clamp(h / 12, 0, 1)`          |
| 5 | flexible load: TASK + ASSIGNMENT hours on the day | `clamp(h / 12, 0, 1)`          |
| 6 | bias                                              | `1`                            |

- Fixed divisors, no running stats: stateless and reproducible. `60` = `MAX_SCAN_DAYS`.
- `is_weekend` is signed so `‖x‖`, and the exploration bonus, is equal on every day.
- `d` fixes the width of `BanditArmState.A` (d x d), `.b` and `SlotProposal.featureVector`.
- Changing `d` means resetting arm state and bumping `BANDIT_MODEL_VERSION` (`linucb-d7-v1`).
- Never inputs: the preference matrix, tags, session type, titles, notes.
- Code: `services/bandit/src/core/context_vector.py`.

## 6. Cold start and per-student state

Every arm starts at the ridge prior:

```text
A = λI   (λ = 1.0)
b = 0
```

- A cold arm scores its exploration bonus `α·√(xᵀx/λ)`, never a fixed `0`.
- An arm whose placements get moved therefore falls below untried arms.
- Each student has six independent `(A, b)` pairs, one per arm.

### 6.1 Persistence

`(A, b)` lives in a dedicated Postgres table in the existing Prisma database. It is never queried by similarity, so no pgvector and no separate instance.

```prisma
model BanditArmState {
  userId    String
  arm       SchedulingArm
  A         Float[]        // d·d row-major, d = 7
  b         Float[]        // d
  version   Int            @default(0)  // optimistic-concurrency guard
  updatedAt DateTime       @updatedAt
  @@id([userId, arm])
}
```

- The Python service (`services/bandit/`) is stateless.
- NestJS loads the 6 arms, passes them in each `/v1/place` / `/v1/update` payload and persists the returned `(A, b)`.
- Rows are created lazily at the prior on first use.

## 7. Reward

The reward is the ADR-0002 move-or-keep signal. A resize is a `MOVE` with `dragDistanceMinutes == 0`.

| Event                          | Reward                                        |
| ------------------------------ | --------------------------------------------- |
| `RETAINED`                     | `+1`: elapsed and never moved                 |
| `MOVE`                         | `−min(1, abs(dragDistanceMinutes) / D_SCALE)` |
| `MOVE`, resize only (drag = 0) | `0`                                           |
| `CREATE`                       | `0`: logged only, no update                   |

- The `MOVE` penalty ramps linearly from `0` to `−1` at a displacement of 4 h or more.
- Displacement is measured from the originally proposed start (`SlotProposal.proposedStartTime`).
- Only the first `MOVE` after a proposal updates the bandit; later moves are logged only.
- 👍 / 👎 feedback is an evaluation-only signal, not a reward ([ab-testing.md](../scheduler/ab-testing.md)).

## 8. Query flow and arm to timestamp mapping

LinUCB is queried once per candidate day, not per 15-minute slot. For a `TASK` with deadline `dl`:

1. For each day in `[next_15min(now), dl]`, build `x` (§5) and score all 6 arms (`/v1/place`, ADR-0003).
2. Generate 15-minute-aligned starts; keep those that are fully empty and satisfy §8.1.
3. Score survivors in one pass (§13 gives the current formula): `slot_score(c) = Σ_arm overlap_rate(c, arm) · score(day(c), arm)` plus a stability term.
4. Pick the highest score; the earliest start breaks ties.

- `overlap_rate` is the fraction of `[c, c + duration)` inside the arm's band.
- A slot crossing local midnight is split there; each part uses its own day's scores.
- Existing sessions are never moved to improve a score (except displacement, §13).
- Detail and worked examples: [reranking.md](../scheduler/reranking.md).

### 8.1 Hard constraints

Applied only in step 2; LinUCB scores all 6 arms unconstrained.

1. `start ≥ next_15min(now)`.
2. `start + duration ≤ deadline`.
3. 15-minute grid alignment.
4. No overlap with: fixed sessions (`ASSIGNMENT` / `EXAM` / `LECTURE`), standalone and recurring `DND`, other placed `TASK`s, and a series member's placed siblings.
5. The slot is fully empty (no partial overlap).

A slot may run past local midnight up to the deadline; there is no same-day constraint.

## 9. Delayed-feedback bookkeeping

Rewards arrive minutes to days later (a `MOVE`, or the half-hourly `RETAINED` sweep). The pending state lives on `SlotProposal`:

- `featureVector Float[]`: the length-`d` context for the chosen day.
- `selectedArm SchedulingArm`: the arm containing the chosen start.
- `SessionEvent.slotProposalId String?`: lets a `MOVE` / `RETAINED` find its proposal.

Lifecycle, for a session whose `SlotProposal.primaryPolicy == LINUCB`:

1. The first `MOVE` or the `RETAINED` sweep fires.
2. The backend computes the §7 reward.
3. It calls `/update` with `(selectedArm, featureVector, reward, A, b)`.
4. It persists the returned `(A, b)` and stamps the proposal consumed (`observationCount++`).

## 10. Parameters

| Parameter       | Value  | Notes                                                                                                                                    |
| --------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| ridge `λ`       | `1.0`  | `A = λI` at cold start; default in `services/bandit/src/models/linucb.py`                                                                |
| exploration `α` | `0.15` | `BANDIT_ALPHA` in `backend/src/scheduler/constants.ts`, sent per request; stability over exploration; tune via offline replay            |
| `D_SCALE`       | `240`  | minutes; `MOVE` penalty saturates at 4 h                                                                                                 |
| `MAX_SCAN_DAYS` | `60`   | candidate-day horizon and feature divisor; feeds every stored feature vector, so changing it is a migration                              |

- Seeding from the user's own `preferenceMatrix` is not shipped.
- Evidence: [heuristic-vs-linucb-report.md](../scheduler/heuristic-vs-linucb-report.md).

## 11. A/B integration

LinUCB (Policy B) is compared with the preference heuristic (Policy A) under the same hard constraints.

- Both place only the current session (or series member) into an empty slot and never repack others.
- `ExperimentService` assigns a 50/50 `primaryPolicy` per scheduling event and records one `SlotProposal`.
- A `sessionCount > 1` series runs the 50/50 pick per member, each within `± max(1, floor(X/N))` days of its even-spread target (`X` = whole days to deadline, `N` = member count).
- See [ab-testing.md](../scheduler/ab-testing.md).

*Amended by #58:*
- A series takes one 50/50 roll and one pairwise roll; every sitting shares the primary policy.
- On a pairwise hit the placer computes two full series plans (all-heuristic, all-LinUCB), each with its own sibling ledger.
- Each sitting's `SlotProposal` pairs its pick in the applied plan with its pick in the other.
- One `SlotProposal` per member is still recorded.

## 12. Decision summary

```text
context vector x (user x task x candidate day), d = 7
    ↓
6 half-open time-of-day arms, Disjoint LinUCB (λ = 1.0, α = 0.15)
    ↓
per-day (day, arm) scores
    ↓
single-pass slot scoring: Σ overlap·arm-score + stability, empty slots only
    ↓
concrete timestamp + SlotProposal (featureVector, selectedArm)
    ↓
delayed reward: MOVE (graded, first only) / RETAINED (+1) → /update → BanditArmState
```

- Scoring and slot search: `services/bandit/src/core/`.
- `/v1/place` and `/v1/update` calls, `SlotProposal` writes and persistence: `backend/src/scheduler/io/*` and `backend/src/bandit/*`.

## 13. Addendum (2026-09-21, issue #62): slot-first scoring

Supersedes §8's "arm, then minute" pick. No separate ADR exists for #62.

**Problem.** An untrained bandit scores every arm 0, so a new user was proposed 00:00. A larger preference nudge would make LinUCB irrelevant.

**Decision.**

1. `services/bandit/src/core/linucb_best_slot.py` scores every feasible 15-minute start on every candidate day and ranks across days.
   - Starts include 23:45 overhanging midnight; the deadline caps the end and need not be slot-aligned.
   - `score = Σ_arm overlapRate(slot, arm) · armScore[day][arm] + wS · stability(prevStart, slot)`.
   - `armScore[day]` is the arm's score for the day the slot starts on.
   - `selectedArm` (credited by the delayed `/update`) is the arm containing the start.
2. Stability weight `wS` is proximity-scaled (`core/slot_score.py`):
   - `STABILITY_WEIGHT_NEAR = 1.0` up to `STABILITY_NEAR_HOURS = 24`.
   - Fades linearly to `STABILITY_WEIGHT_FAR = 0.05` at `STABILITY_FAR_HOURS = 168`.
   - Upcoming tasks barely move; distant ones follow LinUCB.
   - Applied weights are stored on `SlotProposal.linucbWeight` / `.stabilityWeight`.
   - The heuristic stays preference-only, so the A/B keeps two distinct policies.
3. Exact ties (within 1e-9), in order:
   - the start's arm in `TIE_BREAK_ARM_ORDER` (seeded per request; decides the band at full cold start, `EARLY_MORNING` last);
   - distance from the band's centre, a fixed rule that learns nothing (the preference term of ADR-0012 comes first and decides the hour whenever the matrix is not flat);
   - the earlier start.
4. `/update` is unchanged.
5. `MAX_SCAN_DAYS` stays 60 (it normalizes `x`). A single-task scan covers at most `SCAN_CAP_DAYS = 30`.

**Displacement.** §11's "no displacement" is relaxed only when a `TASK` has no free slot before its deadline.

- `core/displacement.py` repacks standalone flexible tasks on the deadline day (widening to ±1 day) in earliest-deadline-first order.
- It is capped at `MAX_DISPLACED_TASKS = 6` and minimizes moves.
- Fixed blocks and series sittings never move.
- Scheduler moves are `SYSTEM_MOVE` events (reward 0): no bandit update, no preference change.
- If still infeasible the API returns `409 SCHEDULE_INFEASIBLE`.
- The client retries with `infeasiblePolicy: "ACCEPT_CONFLICTS" | "ACCEPT_LATE_DEADLINE"`.

## 14. Addendum (2026-09-23): fast learning for MVP verification

Replaces d = 22, the "cold arm scores 0" rule and the preference-matrix in-band tie-break.

- **Cold arm = ridge prior.** Every untried arm scores `α·√(xᵀx/λ)`.
  - Before: a cold arm was pinned at `0`, so the first rewarded arm won forever, even when moved.
- **d = 22 → 7** (§5.1).
  - Dropped: `semester_phase` (always 0), weekday one-hots (collinear with the bias), per-type hours and counts (overlapping, mostly 0).
  - Stored d = 22 arm state must be cleared before deploy (`BANDIT_MODEL_VERSION = "linucb-d7-v1"`).
  - Delayed rewards for d = 22 proposals are dropped (`FEATURE_DIM` in `@zenflow/shared`).
- **No preference matrix in LinUCB** (superseded by [ADR-0012](0012-linucb-time-of-day-arms.md): the matrix is now a weighted slot-score term). Inside the winning band the start nearest the band centre wins, so the A/B stays pure LinUCB vs pure heuristic.
- **AFTERNOON `[11:00, 17:00)` split into MIDDAY `[11:00, 14:00)` + AFTERNOON `[14:00, 17:00)`.**
  - Each task goes to its band's centre, so a 6 h band could only offer 13:30.
  - A fixed band is now found in ≤ 5 placements.
- **Evidence:** `services/bandit/tests/test_learning.py` runs the real place, reward, update loop on simulated users.
  - A fixed band is found in ≤ 5 placements, then held.
  - A weekday/weekend split is learned by the 3rd weekend.
- **Deferred until prod data points to them:** hybrid LinUCB, a per-user matrix-seeded prior.
