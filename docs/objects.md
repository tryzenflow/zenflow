# Objects

The domain model for Zenflow. Each object maps directly to database tables, API response shapes, or internal engine concepts.

---

## Core Entities

### User

The root tenant entity. All scheduling data is scoped to a user.

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | Primary key, global sharding key |
| `email` | string | Unique, B-Tree indexed |
| `password_hash` | string | bcrypt, cost ≥ 12 |
| `role_archetype_id` | string | Phase 4: cluster ID for cold-start seeding |
| `timezone` | string | Valid IANA timezone (e.g., `Asia/Saigon`) |
| `work_start` | int | Absolute minutes from midnight (default: 540 = 09:00) |
| `work_end` | int | Absolute minutes from midnight (default: 1020 = 17:00) |
| `work_days` | int[] | ISO weekdays present (1=Mon … 7=Sun) |
| `penalty_matrix` | int[] | Flat array of 336 ints (7 days × 48 half-hour slots) |
| `created_at` | timestamp | |

**Invariants:**
- `work_start < work_end`
- `work_end - work_start` ≥ 60 (minimum 1-hour workday)
- `penalty_matrix.length === 336` always

---

### Task

The primary schedulable unit.

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | Primary key |
| `user_id` | UUID | FK → users; tenant isolation |
| `title` | string | |
| `duration_minutes` | int | Must be a positive multiple of 15 |
| `deadline` | timestamp? | Optional; indexed for EDF sort |
| `tags` | string[] | PostgreSQL `text[]`; free-form |
| `fixed` | bool | If true, `start_time` is authoritative |
| `start_time` | int | Absolute minutes (fixed tasks only; 0 otherwise) |
| `status` | enum | `PENDING` \| `DONE` |
| `rrule` | string | RFC 5545 recurrence rule string (empty if non-recurring) |
| `scheduled_start_time` | timestamp | Set by EDF engine on create/reschedule |
| `created_at` | timestamp | |

**Invariants:**
- `duration_minutes % 15 === 0`
- Fixed tasks: `start_time` falls within `[user.work_start, user.work_end - duration_minutes]`
- `scheduled_start_time` always falls within user's working hours and work days

---

### TaskEvent

Append-only audit log. Source of truth for the intelligence layer.

| Field | Type | Notes |
|---|---|---|
| `id` | bigint | Auto-increment PK |
| `task_id` | UUID | FK → tasks (cascade delete) |
| `user_id` | UUID | FK → users (denormalized for partition-local queries) |
| `event_type` | enum | `CREATE` \| `MOVE` \| `RESIZE` \| `COMPLETE` |
| `old_snapshot` | jsonb? | Previous `{scheduled_start_time, duration_minutes}`; null on CREATE |
| `new_snapshot` | jsonb | New `{scheduled_start_time, duration_minutes}` |
| `reward_score` | float | Phase 3: bandit reward (1.0 = accepted, 0.0 = overridden) |
| `occurred_at` | timestamp | Range-partitioned monthly |

---

### EstimationBias

Per-user, per-tag rolling bias multiplier calculated by the daily cron job.

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | |
| `user_id` | UUID | FK → users |
| `tag` | string | Single tag (e.g., `"backend"`) |
| `bias_multiplier` | float | Rolling average of `actual_duration / estimated_duration` |
| `task_sample_count` | int | Minimum 5 samples required before activation |
| `updated_at` | timestamp | |

---

### BanditModel

One model per user. Stores the serialized bandit weight matrix.

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | |
| `user_id` | UUID | Unique FK → users |
| `weight_matrix` | jsonb | Flattened LinUCB state tensor for FastAPI |
| `total_training_steps` | int | Monotonically increasing |
| `updated_at` | timestamp | |

---

## Conceptual Models

These are not database tables but are core to understanding the scheduling engine.

### SchedulingHorizon

Defines the time window within which the EDF engine places tasks, based on the active view.

| View | With Deadline | Without Deadline |
|---|---|---|
| Day | `[max(now, work_start_today), deadline_day_work_end]` | `[max(now, work_start_today), work_end_today]` |
| Week | `[max(now, week_start), deadline_date]` | `[max(now, week_start), work_end_friday]` |
| Month | `[now, deadline_date]` | `[now, last_working_day_of_month]` |

### PenaltyMatrix

A personalized aversion heatmap stored as a flat 336-integer array.

```
Array Index = (day × 48) + time_block
  day:        0=Mon … 6=Sun
  time_block: 0=00:00, 1=00:30 … 47=23:30
```

Example coordinate: Friday 04:30 PM → `(4 × 48) + 33 = index 225`

The EDF cost function in Phase 2:
```
Score(slot) = urgency_weight × time_to_deadline + penalty_matrix[slot_index]
```

Low penalty score → green zone (engine prefers this slot).
High penalty score (20+) → red zone (engine avoids unless urgency overrides).

### FeatureVector

The multi-dimensional context passed to the FastAPI bandit service.

```
[day_of_week, hours_to_deadline, current_day_load_hours, t₁, t₂, … tₙ]
```

Where `t₁…tₙ` are multi-hot encoded tag bits (0 or 1) for each tag in the global tag pool.

Example for `["backend", "critical"]` with global pool `["backend", "admin", "critical", "marketing"]`:
```
[1, 28.5, 3.0, 1, 0, 1, 0]
 ^   ^     ^   backend admin critical marketing
 Mon
```

### Archetype

A behavioral cluster derived from aggregate multi-tag co-occurrence analysis (Phase 4).

| Archetype | Tag Signature | Seeded Behaviors |
|---|---|---|
| `night-owl-dev` | `#backend + #ops` | Avoids morning slots, peaks mid-afternoon |
| `creative-lead` | `#marketing + #copy` | Peaks in morning, avoids Friday afternoons |
| `finance-ops` | `#finance + #admin` | Structured 09-12 blocks, hard cutoff at 17:00 |

### TaskCard (UI)

The visual representation of a task on the calendar grid.

| State | Visual Treatment |
|---|---|
| Scheduled (fluid) | `bg-card border-l-4 border-l-primary` |
| Scheduled (fixed) | `bg-muted border-dashed border-border` with lock icon |
| Overdue | `bg-destructive/10 border-l-4 border-l-destructive text-destructive` |
| Conflict | `bg-amber-50 border-l-4 border-l-amber-500 text-amber-900` |
| Completed | `bg-muted border-l-4 border-l-emerald-500 opacity-60 line-through` |
