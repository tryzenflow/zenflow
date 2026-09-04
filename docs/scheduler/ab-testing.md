# Zenflow Scheduling A/B Testing Strategy

## Goal

Evaluate whether personalized Disjoint LinUCB produces better scheduling recommendations
than the existing personalized heuristic based on the user's preference matrix.

The experiment compares the two scheduling policies under the same task, user, calendar,
and scheduling constraints.

The primary question is:

> Does contextual online learning improve students' acceptance and subsequent adherence to
> generated schedules compared with a simpler personalized preference heuristic?

The experiment should prioritize **real user behavior** over synthetic or offline metrics.

---

## 1. Compared Policies

Both policies schedule **only the current `TASK`**, into an **empty** feasible slot, and
**never repack or move other sessions**. They share the entire arm → timestamp mapping in
[`reranking.md`](./reranking.md) (candidate-day scan, hard-constraint + empty-slot filter,
single-pass slot scoring, earliest-start tie-break). They differ only in **how a slot's
temporal-preference score is computed**.

### A — Preference Heuristic

Slot score = the sum, over every hour bucket the interval `[start, start + duration)`
touches, of `User.preferenceMatrix[weekday, hour]` — exactly `bestFreeSlot` /
`slotPreferenceScore` in [`heuristic.ts`](../../backend/src/scheduler/heuristic.ts). No
contextual reward model, no learning. This is `HeuristicScheduleService.scheduleTask` as
it runs everywhere — single-session, empty-slot-only, no existing session moved; there is
no separate "restricted" mode and no full-day repack.

### B — Disjoint LinUCB

Slot score = `Σ_arm overlap_rate(slot, arm) × linucbScore(day, arm) + slotPreferenceScore(slot)`,
where `linucbScore` comes from per-student, per-arm state
(see [`../adr/0001-linucb-model-design.md`](../adr/0001-linucb-model-design.md)) and the
`slotPreferenceScore` addend is the same overlap-weighted preference score as Policy A —
a **cold-start blend** (scheduler reorg) so a slot still ranks sensibly before any arm has
accumulated reward. LinUCB scores every `(candidate_day, arm)` pair; online reward updates
come from the ADR-0002 move-or-keep signal.

There is **no deviation weight / deviation penalty**. The stability guarantee
(empty-slot-only, no displacement) is shared by both policies, so neither needs a
move-cost term. Both policies' per-slot scores now carry the overlap-weighted preference
term; they differ only in the additional LinUCB arm term.

---

## 2. Randomization

For every scheduling-triggering event, randomly assign the primary scheduling policy:

```text
50% → Preference Heuristic
50% → Disjoint LinUCB
```

Scheduling-triggering events:

- task creation (a `TASK` series records one proposal **per member** — the reorg brought
  series members onto the same per-member 50/50 A/B path, bounded to a `± floor(X/N)`-day
  window around each member's even-spread target);
- task deadline modification;
- task deletion that requires rescheduling;
- explicit rescheduling requested by the user.

Log the randomization for every event (`SlotProposal.experimentId`, `primaryPolicy`,
`randomizationSeed`, `userId`, `sessionId`, `timestamp`). Randomization must not depend on
the student's characteristics, task type, deadline, or previous behavior.

---

## 3. Optional Pairwise Comparison

To collect explicit preference alongside passive behavioral feedback, a subset of events
may show the user both policies' proposed schedules:

```text
Schedule A                 Schedule B

Math       Mon 09:00       Math       Mon 10:00
Physics    Tue 14:00       Physics    Tue 14:00
English    Wed 20:00       English    Thu 20:00

[Choose A]                 [Choose B]
```

The policy identities are not shown. Randomize the presentation position:

```text
50%: A = Heuristic, B = LinUCB
50%: A = LinUCB,    B = Heuristic
```

Only meaningful differences need highlighting. Use pairwise comparison sparingly so normal
scheduling stays unobtrusive. The choice is recorded (`SlotProposal.pairwiseShown`,
`pairwisePositions`, `chosenByUser`) for the win-rate metric — it is **not** a LinUCB
weight update (§4).

---

## 4. Like / Dislike Feedback

A lightweight explicit mechanism may follow a generated schedule:

```text
Was this schedule helpful?

👍    👎
```

Like/dislike is an **evaluation signal only**. It is deliberately kept separate from the
LinUCB behavioral reward:

- A 👍 means "the user reports they liked the recommendation" — not "the user completed
  the task at that time".
- It is a schedule-level judgement; attributing one thumb to a single `(arm, context)`
  pull would misassign credit and mix signal scales with the ±1 move/keep reward.

The sole LinUCB reward is the ADR-0002 move-or-keep signal (`MOVE` graded by displacement,
`RETAINED = +1`; ADR-0001 §7). 👍 / 👎 and the pairwise choice are recorded for offline
analysis and reported as metrics (§6), nothing more.

---

## 5. Shared Final Ranking

Both policies use the identical downstream mapping, so the comparison is fair:

```text
                 ┌─────────────────────────┐
                 │ Generate candidate slots│
                 │ (15-min grid, to dl)    │
                 └───────────┬─────────────┘
                             ↓
                 ┌─────────────────────────┐
                 │ Hard-constraint +       │
                 │ empty-slot filter       │
                 └───────────┬─────────────┘
                             ↓
             per-slot temporal score:
             Heuristic  → Σ preferenceMatrix[weekday, hour]
             LinUCB     → Σ overlap_rate × linucbScore(day, arm)
                             ↓
                 ┌─────────────────────────┐
                 │ Rank ↓, earliest-start  │
                 │ tie-break               │
                 └───────────┬─────────────┘
                             ↓
                     concrete timestamp
                     + SlotProposal
```

No deviation weight, no displacement — the only difference between the arms of the
experiment is the per-slot temporal score.

---

## 6. Primary Evaluation Metrics

### Primary metric

**Schedule acceptance rate** — the proportion of generated recommendations users accept
without meaningful modification (`SlotProposal.acceptedWithoutModification`).

### Secondary metrics

- task retention rate (`RETAINED` vs `MOVE`);
- drag frequency;
- average drag distance (`dragDistanceMinutes`);
- deletion rate;
- explicit like/dislike rate;
- pairwise preference win rate;
- time until first modification (`firstModifiedAt − timestamp`);
- schedule divergence between policies.

For pairwise experiments: `LinUCB wins` / `Heuristic wins` / `Tie` analyzed directly.

---

## 7. Cold-Start / Adaptation Analysis

Evaluate how performance changes as the model accumulates feedback. Partition observations
by per-user interaction count:

```text
0–5   6–10   11–20   21–40   40+
```

Compare LinUCB and the heuristic within each bucket. Hypothesised shape:

```text
Cold start:            Heuristic > LinUCB
After enough feedback: LinUCB > Heuristic
```

A lack of improvement is also a valid result.

---

## 8. Required Experiment Logging

`SlotProposal` records the proposal, the randomization, the applied outcome, the pairwise
presentation and choice, and the 👍 / 👎 feedback. These `choose` / `like` / `dislike`
records are used for **offline evaluation only** — they do **not** update LinUCB weights or
the preference matrix. The only writers of learned state are:

- LinUCB `(A, b)` ← the `MOVE` / `RETAINED` reward via `/update` (ADR-0001 §9);
- `preferenceMatrix` ← the nightly decay cron today (a move/keep acquisition writer is a
  later phase — see [`heuristic.md`](./heuristic.md)).
