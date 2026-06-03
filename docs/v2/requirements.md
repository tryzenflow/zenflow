# Requirements

## Functional Requirements

### Auth

| ID | Requirement |
|---|---|
| FR-A01 | User can register with email and password |
| FR-A02 | User can log in and receive a session token |
| FR-A03 | All API endpoints require authentication; data is scoped to the authenticated user |

### Onboarding

| ID | Requirement |
|---|---|
| FR-O01 | On first login, user completes a single-step wizard before accessing the dashboard |
| FR-O02 | Wizard captures: work start time, work end time, work days (ISO weekdays), and a role tag for archetype seeding |
| FR-O03 | Work hours are stored as absolute minutes (e.g., 09:00 → 540, 17:00 → 1020) |
| FR-O04 | Onboarding values seed the EDF engine immediately; no tasks can be created until onboarding is complete |

### Task Management

| ID | Requirement |
|---|---|
| FR-T01 | User can create a task with: title, duration (multiple of 15 min), optional deadline, optional tags, fixed/flexible type |
| FR-T02 | Flexible tasks have no user-defined start time; the engine assigns one |
| FR-T03 | Fixed tasks require a start time; the engine treats them as immutable anchors |
| FR-T04 | Tags are free-form text strings stored as an array on the task |
| FR-T05 | Deadlines are optional; absence triggers view-bound soft scheduling |
| FR-T06 | User can edit any task field except `scheduled_start_time` on fixed tasks (managed by engine) |
| FR-T07 | User can mark a task as complete |
| FR-T08 | User can delete a task; cascades delete on task events |

### Scheduling

| ID | Requirement |
|---|---|
| FR-S01 | On task creation, the EDF engine assigns a `scheduled_start_time` within the user's work hours |
| FR-S02 | EDF sorts tasks by deadline ascending; no deadline tasks are treated as lower-priority buffer tasks |
| FR-S03 | The scheduling horizon adapts to the active view (Day / Week / Month) per the rules in [Heuristic Progression](heuristic-progression.md) |
| FR-S04 | Fixed tasks anchor their `start_time` absolutely; the engine routes around them |
| FR-S05 | If a manual move collides with a fixed task, the engine cascades realignment to the next open slot |
| FR-S06 | Tasks in conflict state (no available slot before deadline) turn amber and surface in the Agenda Queue |
| FR-S07 | Overdue tasks (now > deadline, status ≠ DONE) turn red |
| FR-S08 | Recurrence is view-scoped: Day view has none, Week view allows by-day patterns, Month view allows by-week patterns |

### Manual Interaction

| ID | Requirement |
|---|---|
| FR-M01 | User can drag a task card to any 15-minute slot in the calendar, including outside configured work hours and on non-work days (exceptions) |
| FR-M02 | User can resize a task by dragging its bottom edge; snaps to 15-minute intervals |
| FR-M03 | Every drag and resize fires a telemetry event logged to `task_events` |
| FR-M04 | The penalty matrix slot index is incremented on every MOVE event |

### Intelligence

| ID | Requirement |
|---|---|
| FR-I01 | A daily cron job calculates estimation bias per user per tag from completed task history |
| FR-I02 | Conservative max-bias strategy: the highest single-tag multiplier is applied when a task has multiple tags |
| FR-I03 | Phase 3: A FastAPI microservice provides contextual bandit slot recommendations |
| FR-I04 | Phase 4: New users are seeded with an archetype's baseline penalty matrix and bandit weights |

---

## Non-Functional Requirements

| ID | Category | Requirement |
|---|---|---|
| NFR-01 | Performance | Scheduling response (EDF placement) P95 < 200ms |
| NFR-02 | Performance | FastAPI bandit prediction P95 < 150ms |
| NFR-03 | Performance | UI renders initial schedule in < 1s on 4G |
| NFR-04 | Reliability | API uptime ≥ 99.5% monthly |
| NFR-05 | Reliability | `task_events` partitioned monthly; range queries remain sub-100ms up to 10M rows per partition |
| NFR-06 | Security | Passwords stored as bcrypt hashes (cost ≥ 12) |
| NFR-07 | Security | All queries scoped by `user_id`; no cross-tenant data leakage |
| NFR-08 | Security | JWT tokens expire in 7 days; refresh token rotation |
| NFR-09 | Correctness | All time calculations performed in the user's IANA timezone |
| NFR-10 | Correctness | All durations rounded up to the nearest 15-minute multiple |
| NFR-11 | Accessibility | WCAG 2.1 AA compliance on all interactive components |
| NFR-12 | Accessibility | Keyboard-navigable calendar grid (arrow keys move focus between slots) |
| NFR-13 | Progressive | App functions as a PWA; core read views available offline |
| NFR-14 | Responsiveness | Usable on screens ≥ 375px wide (mobile day view collapses sidebar) |

---

## Product Constraints

- Duration must be a multiple of 15 minutes (enforced at API + UI layer).
- No earliest start date; tasks are assumed immediately executable.
- Recurrence is only configurable in Week and Month views.
- The penalty matrix covers 7 × 48 half-hour slots (not quarter-hour) for storage efficiency; slot resolution is half-hour for aversion tracking, quarter-hour for actual scheduling.
