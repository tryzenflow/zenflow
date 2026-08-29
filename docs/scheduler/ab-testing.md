# Zenflow Scheduling A/B Testing Strategy

## Goal

Evaluate whether personalized Disjoint LinUCB produces better scheduling recommendations than the existing personalized heuristic based on the user's preference matrix.

The experiment compares the two scheduling policies under the same task, user, calendar, and scheduling constraints.

The primary question is:

> Does contextual online learning improve students' acceptance and subsequent adherence to generated schedules compared with a simpler personalized preference heuristic?

The experiment should prioritize **real user behavior** over synthetic or offline metrics.

---

## 1. Compared Policies

### A — Preference Heuristic

The heuristic uses:

- the user's preference matrix over time-of-day categories;
- scheduling constraints;
- a deviation penalty for moving recently user-adjusted sessions.

The heuristic does not learn a contextual reward model.

### B — Disjoint LinUCB

LinUCB uses:

- the same feasible candidate slots;
- the same task/user/schedule context;
- five reusable time-of-day arms;
- per-student arm state;
- online reward updates from user behavior.

LinUCB produces an arm and its score. The scheduler/API is responsible for mapping the arm to concrete candidate timestamps and applying the same final ranking/deviation logic used by the heuristic.

---

## 2. Randomization

For every scheduling-triggering event, randomly assign the primary scheduling policy:

```text
50% → Preference Heuristic
50% → Disjoint LinUCB
```

Scheduling-triggering events include:

- task creation;
- task deadline modification;
- task deletion that requires rescheduling;
- explicit rescheduling requested by the user.

The randomization should be logged for every event.

Example:

```text
experiment_id
student_id
task_id
primary_policy
randomization_seed
timestamp
```

Randomization should not depend on the student's characteristics, task type, deadline, or previous behavior.

---

## 3. Optional Pairwise Comparison

To collect explicit preference in addition to passive behavioral feedback, a subset of scheduling events may show the user both policies' proposed schedules.

For example:

```text
Schedule A                 Schedule B

Math       Mon 09:00       Math       Mon 10:00
Physics    Tue 14:00       Physics    Tue 14:00
English    Wed 20:00       English    Thu 20:00

[Choose A]                 [Choose B]
```

The identities of the policies should not be shown.

Randomize the presentation position:

```text
50%: A = Heuristic, B = LinUCB
50%: A = LinUCB,    B = Heuristic
```

Only meaningful differences need to be highlighted. Identical sessions do not need to be presented as separate choices.

Pairwise comparison should be used sparingly so that the experiment does not make normal scheduling interactions unnecessarily intrusive.

---

## 4. Like / Dislike Feedback

A lightweight explicit feedback mechanism may also be provided after a generated schedule:

```text
Was this schedule helpful?

👍    👎
```

This provides an explicit subjective signal.

However, like/dislike should be treated separately from the LinUCB behavioral reward.

A like means:

> "The user reports that they liked the recommendation."

It does not necessarily mean:

> "The user completed the task successfully."

Therefore, like/dislike is an evaluation signal rather than automatically becoming the same reward used for model updates.

---

## 7. Shared Final Ranking

To ensure a fair comparison, both policies use the same downstream candidate-ranking mechanism.

The policies differ only in **how they score temporal preferences**.

```text
                 ┌────────────────────┐
                 │ Generate candidates│
                 └─────────┬──────────┘
                           ↓
                 ┌────────────────────┐
                 │ Heuristic OR       │
                 │ LinUCB             │
                 └─────────┬──────────┘
                           ↓
                 arm/model score
                           ↓
                 ┌────────────────────┐
                 │ Shared API ranking │
                 │ + deviation weight │
                 └─────────┬──────────┘
                           ↓
                    concrete timestamp
```

This prevents the final scheduler from giving one policy an advantage through a different realization or stability mechanism.

---

## 8. Primary Evaluation Metrics

### Primary metric

**Schedule acceptance rate**

The proportion of generated recommendations that users accept without meaningful modification.

### Secondary metrics

- task completion rate;
- completion at scheduled time;
- drag frequency;
- average drag distance;
- deletion rate;
- explicit like/dislike rate;
- pairwise preference win rate;
- time until first modification;
- schedule divergence between policies.

For pairwise experiments:

```text
LinUCB wins
Heuristic wins
Tie / no meaningful difference
```

can be analyzed directly.

---

## 9. Cold-Start / Adaptation Analysis

The experiment should evaluate not only overall performance but also how performance changes as the model receives more feedback.

Partition observations by interaction count or data volume, for example:

```text
0–5 observations
6–10
11–20
21–40
40+
```

Compare LinUCB and the heuristic within these buckets.

This tests the thesis hypothesis that contextual online learning can improve personalization as behavioral evidence accumulates.

A possible outcome is:

```text
Cold start:
Heuristic > LinUCB

After sufficient feedback:
LinUCB > Heuristic
```

A lack of improvement is also a valid result.

---

## 10. Required Experiment Logging

Modify `SlotProposal` to record like/dislike/choose events, which can be used to update LinUCB weights and heuristic preference matrix.
