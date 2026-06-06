# Heuristic Progression

Zenflow's scheduling intelligence evolves across four phases. Each phase is independently shippable and builds on the prior one.

---

## Roadmap Summary

| Phase | Engine | Complexity | Data Required | Cold-Start Quality |
|---|---|---|---|---|
| 1 | Pure EDF | Low | None | Baseline (deterministic) |
| 2 | EDF + Penalty Matrix + Bias | Medium-Low | 1–2 weeks (single user) | Better than baseline |
| 3 | Contextual Bandit (LinUCB) | Medium-High | 1 month (single user) | Good |
| 4 | Bandit + Collaborative Archetypes | High | Multi-user dataset | Excellent (near-instant) |

---

## Phase 1: Deterministic EDF Core

**Goal:** Ship a working scheduling product with zero ML overhead.

### Algorithm

Earliest-Deadline First (EDF) — assigns tasks in deadline-ascending order to the first available 15-minute slot within the user's work hours.

**Scheduling horizon by view:**

| View | With Deadline | Without Deadline |
|---|---|---|
| Day | `[max(now, work_start_today), deadline_day_end]` | `[max(now, work_start_today), work_end_today]` |
| Week | `[max(now, week_start), deadline_date]` | `[max(now, week_start), work_end_friday]` |
| Month | `[now, deadline_date]` | `[now, last_work_day_of_month]` |

**Fixed task rule:** `fixed: true` tasks are treated as immutable anchors. The EDF engine routes around them.

### Phase 1 Deliverables

- NestJS API with full CRUD + `/reschedule` endpoint.
- React PWA with Day / Week / Month views.
- Drag-and-drop task repositioning (snaps to 15-min grid).
- Cascading realignment on collision.
- `task_events` audit table recording all CREATE / MOVE / RESIZE / COMPLETE events.
- Penalty matrix incremented on MOVE (values collected but not yet used in scheduling).

---

## Phase 2: Heuristic Adaptation

**Goal:** Make the engine feel "smart" using purely statistical rules — no ML training loop required.

### 2a: Estimation Bias Per Tag

A daily cron job calculates a per-user, per-tag bias multiplier from historical COMPLETE events:

```
bias(user, tag) = mean(actual_duration / estimated_duration)
```

Applied before EDF slot assignment:
```
adjusted_duration = original_duration × max(bias for each tag)
adjusted_duration = ceil(adjusted_duration / 15) × 15
```

**Conservative Max-Bias Strategy:** When a task has multiple tags, use only the highest individual multiplier to prevent compounding inflation.

**Activation threshold:** Requires ≥ 5 completed task samples per tag before the multiplier becomes active.

### 2b: Penalty Matrix Slot Avoidance

The 7 × 48 penalty matrix (stored as a flat 336-integer array on the user row) accumulates aversion scores:

```
penalty_matrix[day × 48 + time_block] += 1  (on every MOVE event)
```

EDF Phase 2 cost function for slot selection:

```
Score(slot) = urgency_weight × hours_to_deadline + penalty_matrix[slot_index]
```

- Far deadline → penalty score dominates → engine skips high-penalty slots.
- Imminent deadline → urgency weight spikes → penalty is overridden.

### 2c: Tag-Inherited Constraints

A task with multiple tags inherits the strictest penalty rules of any single tag. E.g., if `#finance` tasks are historically moved away from Friday afternoons, a new task tagged `#finance + #ops` also avoids Friday afternoons, even if `#ops` has no such pattern.

---

## Phase 3: Contextual Bandit (LinUCB)

**Goal:** Replace static penalty-based avoidance with an adaptive policy that learns the user's scheduling preferences in real-time.

### Architecture

A LinUCB (Linear Upper Confidence Bound) algorithm runs as a FastAPI Python microservice. NestJS calls it via internal HTTP for each task creation.

### Feature Vector (Context)

```
x = [day_of_week, hours_to_deadline, current_day_load_hours, t₁, t₂, … tₙ]
```

Where `t₁…tₙ` are multi-hot encoded tag bits.

**Multi-hot encoding example:**  
Global tag pool: `[backend, admin, critical, marketing]`  
Task tags: `["backend", "critical"]` → vector: `[1, 0, 1, 0]`

### Reward Signal

| User action | Reward |
|---|---|
| Accepts engine's placement (no move) | 1.0 |
| Moves task to a different slot | 0.0 |
| Resizes (duration correction) | 0.5 |

The reward updates the LinUCB weight matrix `W` for the chosen arm (slot), improving future recommendations.

### The Phase 3 Loop

```
1. NestJS builds feature vector for the new task
2. POST /predict → FastAPI
3. FastAPI evaluates all available arms (slots), selects max UCB score
4. Returns recommended_start_time + arm_index
5. NestJS places the task; user interacts
6. POST /update → FastAPI with reward_score based on user action
7. FastAPI updates W for the played arm
```

---

## Phase 4: Collaborative Archetypes (Cold-Start Solution)

**Goal:** Eliminate the data void for new users by bootstrapping their scheduling model from aggregate behavioral patterns.

### Problem

A new user has zero task history. Phase 1–3 engines start from zeros, producing essentially random scheduling for the first few weeks — degrading trust before the product has a chance to demonstrate value.

### Solution: Behavioral Clustering

Periodic matrix factorization (LightFM or collaborative filtering) runs on the full multi-user `task_events` dataset. It identifies clusters of users with similar tag co-occurrence patterns:

| Archetype ID | Tag Signature | Behavioral Pattern |
|---|---|---|
| `night-owl-dev` | `#backend + #ops` | Prefers afternoon-to-evening slots; avoids early mornings |
| `creative-lead` | `#marketing + #copy` | Peaks pre-noon; hard avoidance of Friday PM |
| `finance-ops` | `#finance + #admin` | Strict 09:00–12:00 block; zero evening scheduling |
| `generalist-pm` | `#planning + #meetings` | Distributed across the day; high recurrence usage |

### Cold-Start Seeding

When a new user completes onboarding and selects a role:

1. System reads the archetype's aggregate `penalty_matrix` (cluster-average slot aversions).
2. System reads the archetype's aggregate LinUCB `weight_matrix`.
3. Both are written to the new user's records instead of zeros.
4. The user's scheduling feels intelligent from their first task.

### Continuous Refinement

As the user accumulates personal task history, their individual penalty matrix and bandit weights drift away from the archetype baseline toward their actual preferences. After ~30 completed tasks, the archetype seed is effectively washed out by personal signal.

---

## Glossary of Terms

| Term | Definition |
|---|---|
| **EDF** | Earliest-Deadline First — tasks sorted by deadline ASC, placed in first open slot |
| **Contextual Bandit** | ML framework balancing exploration of new slots with exploitation of known preferences |
| **LinUCB** | Linear Upper Confidence Bound — specific bandit algorithm using linear feature weights |
| **Feature vector** | Flattened numerical array representing scheduling context at a point in time |
| **Multi-hot encoding** | Binary array representation of a tag set; 1 = tag present, 0 = absent |
| **Estimation bias** | Ratio of actual execution time to original estimated time, averaged per tag |
| **Conservative max-bias** | Resolution strategy: apply only the highest single-tag multiplier to avoid compounding |
| **Penalty matrix** | 7×48 flat integer array; higher values = user avoids that slot |
| **Archetype** | Behavioral cluster derived from aggregate multi-user tag co-occurrence analysis |
| **Cascading realignment** | Recursive loop that re-routes downstream tasks when a slot collision occurs |
| **Conflict state** | Task has no available slot before its deadline; requires user intervention |
| **Anchor task** | `fixed: true` task; the engine treats it as an immovable block |
