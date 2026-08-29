# ADR-001: Disjoint LinUCB Model Design for Zenflow Scheduling

**Status:** Accepted
**Date:** 2026-08-29
**Decision:** Use per-student Disjoint LinUCB with reusable time-of-day arms.

---

## 1. Context

Zenflow needs to learn when each student prefers to perform tasks.

Using every ISO timestamp as an arm would create too many overly specific arms:

```text
2026-09-14T09:00
2026-09-15T09:00
2026-09-16T09:00
```

Knowledge from one timestamp would not transfer well to another.

The model therefore needs reusable arms that:

- represent meaningful time preferences;
- work across different dates;
- learn with limited data;
- keep per-student state manageable.

---

## 2. Decision

Use **Disjoint LinUCB** with:

- one model per student;
- five time-of-day arms;
- shared context features across arms;
- ridge regularization;
- online updates from user behavior.

| Arm             | Time range  |
| --------------- | ----------- |
| `EARLY_MORNING` | 00:00–06:00 |
| `MORNING`       | 06:00–11:00 |
| `AFTERNOON`     | 11:00–17:00 |
| `EVENING`       | 17:00–20:00 |
| `NIGHT`         | 20:00–24:00 |

LinUCB selects a temporal arm. The scheduler then maps it to the best feasible timestamp.

---

## 3. Why Disjoint LinUCB?

The main hypothesis is:

> A student's preferred time depends on the scheduling context.

For example:

```text
ordinary assignment → afternoon
exam preparation    → evening
urgent deadline     → earlier in the day
```

A static preference matrix cannot represent these differences well.

Disjoint LinUCB gives each arm its own context-dependent reward model, without assuming that all time periods behave identically.

---

## 4. Why Not Timestamp or 35-Arm Models?

ISO timestamps are too specific and create a large arm space.

A day-of-week × time-of-day model would create 35 arms. It could capture weekday patterns, but would spread limited observations across too many arms.

The initial design uses:

```text
5 time-of-day arms
+
day of week as context
```

This favors faster learning and better cold-start behavior. Finer granularity can be added later if evaluation justifies it.

---

## 5. Context

The context describes the scheduling situation. Initial features may include:

- normalized time to deadline;
- task type;
- exam or grade-risk weight;
- day of week;
- candidate time of day;
- current or projected workload.

The feature vector should remain compact and use features with clear scheduling relevance.

```text
raw scheduling state
        ↓
feature extraction
        ↓
normalized context vector
```

---

## 6. Cold Start and Per-Student State

Each student starts with no observations.

Every arm is initialized with:

```text
A = λI
b = 0
```

The uncertainty term encourages early exploration. As feedback arrives, each student's arm models are updated independently.

```text
student
├── EARLY_MORNING → A, b
├── MORNING       → A, b
├── AFTERNOON     → A, b
├── EVENING       → A, b
└── NIGHT         → A, b
```

State must be persisted across requests and restarts.

---

## 7. Arm to Concrete Timestamp

LinUCB returns an arm and score, not a final timestamp:

```text
NIGHT → 0.82
```

The scheduler generates feasible 15-minute candidates, assigns them to temporal arms, and performs the final ranking.

Calendar constraints, conflicts, availability, and tie-breaking remain outside LinUCB.

---

## 8. Preference Matrix and User Adjustments

The existing preference matrix remains a separate heuristic and cold-start baseline.

It is not used as LinUCB's learned coefficient matrix.

User drags provide feedback to LinUCB, but recent manual placements are also protected by the scheduler:

```text
user drag
    ├──→ learning signal
    └──→ temporary placement stability
```

This keeps learning and explicit user decisions separate.

---

## 9. Reward and Delayed Feedback

Possible feedback includes:

- accepting a recommendation;
- completing a task near its scheduled time;
- dragging a task;
- deleting a task;
- missing a deadline.

Feedback may arrive later, so the system must retain:

```text
student
task/session
arm
context
recommendation timestamp
```

A drag can be treated as a graded signal: larger movements indicate stronger dissatisfaction.

---

## 10. Why Not Hybrid LinUCB?

Hybrid LinUCB is out of scope for the initial implementation.

It would add shared cross-arm parameters, more complexity, and another model to evaluate. The current thesis question is narrower:

> Does contextual online learning improve scheduling compared with the existing heuristic?

Disjoint LinUCB is sufficient to test that question.

---

## 11. Alternatives Considered

| Design                 | Decision     | Reason                              |
| ---------------------- | ------------ | ----------------------------------- |
| ISO timestamp arms     | Rejected     | Too many arms; poor transfer        |
| 35 day × time arms     | Deferred     | More granular, but slower to learn  |
| 5 time-of-day arms     | **Selected** | Small and reusable                  |
| Shared LinUCB          | Rejected     | Assumes identical arm relationships |
| Disjoint LinUCB        | **Selected** | Independent arm-specific models     |
| Hybrid LinUCB          | Deferred     | Not justified by the current scope  |
| Offline pre-training   | Rejected     | No suitable historical data         |
| Per-student state      | **Selected** | Supports personalization            |
| Model-specific ranking | Rejected     | Would confound evaluation           |

---

## 12. Consequences

### Positive

- Small state space.
- Knowledge transfers across dates.
- Faster cold-start learning.
- Context-dependent recommendations.
- Clear separation between learning and calendar constraints.
- Fair comparison with the existing heuristic.

### Negative

- Five buckets lose fine-grained temporal information.
- Weekday-specific preferences are only represented through context.
- Persistent per-student state is required.
- Results depend on feature and reward quality.

---

## 13. Validation

Validate the design through:

1. synthetic tests with known reward patterns;
2. feature and arm-mapping checks;
3. cold-start simulations;
4. an online comparison with the existing heuristic;
5. analysis of performance as observations accumulate.

The main thesis evidence should come from the online comparison.

---

## 14. Decision Summary

Zenflow will use:

```text
per-student state
    ↓
5 time-of-day arms
    ↓
Disjoint LinUCB
    ↓
shared scheduler ranking
    ↓
concrete timestamp
```

The design prioritizes simple state, reusable arms, fast personalization, and a focused evaluation.
