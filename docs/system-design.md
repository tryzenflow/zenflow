# System Design

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         Client Layer                             │
│                                                                  │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │  React PWA  (Vite + TypeScript + Tailwind + shadcn/ui)  │   │
│   │  - Calendar views (Day / Week / Month)                  │   │
│   │  - Drag-and-drop interaction layer                       │   │
│   │  - Optimistic UI updates via React Query                 │   │
│   │  - Service Worker for offline read access                │   │
│   └──────────────────────────┬──────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                               │ HTTPS REST
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Application Layer                          │
│                                                                  │
│   ┌──────────────────────────────────────────────────────────┐  │
│   │               NestJS API  (Port 3001)                    │  │
│   │  ┌────────────┐ ┌────────────┐ ┌──────────────────────┐  │  │
│   │  │  Auth      │ │  Tasks     │ │   Scheduler          │  │  │
│   │  │  Module    │ │  Module    │ │   Service (EDF)      │  │  │
│   │  └────────────┘ └────────────┘ └──────────────────────┘  │  │
│   │  ┌────────────┐ ┌────────────┐ ┌──────────────────────┐  │  │
│   │  │  Users     │ │  Events    │ │   Bias Cron Job      │  │  │
│   │  │  Module    │ │  Module    │ │   (daily @00:05)     │  │  │
│   │  └────────────┘ └────────────┘ └──────────────────────┘  │  │
│   └────────────────────────┬─────────────────────────────────┘  │
│                            │ internal HTTP                        │
│                            ▼                                      │
│   ┌──────────────────────────────────────────────────────────┐  │
│   │           FastAPI Bandit Service  (Port 8000)            │  │
│   │  - POST /predict  → LinUCB slot recommendation           │  │
│   │  - POST /update   → reward feedback after user action    │  │
│   │  - POST /seed     → archetype cold-start seeding         │  │
│   └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                         Data Layer                                │
│                                                                  │
│   ┌──────────────────────────────────────────────────────────┐  │
│   │          PostgreSQL 16  (Primary Database)               │  │
│   │  - users, tasks, bandit_models, estimation_bias         │  │
│   │  - task_events (range-partitioned monthly by occurred_at)│  │
│   │  - Row-level security enforced by user_id               │  │
│   └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│   ┌──────────────────────────────────────────────────────────┐  │
│   │          Redis  (Ephemeral Cache)                        │  │
│   │  - Session token store (JWT blacklist on logout)         │  │
│   │  - Cascade lock: prevents concurrent EDF conflicts       │  │
│   └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Request Lifecycle: Create Flexible Task

```
1. User submits form
   └─► React → POST /tasks (NestJS)

2. NestJS: Auth guard validates JWT
   └─► TasksModule.create()

3. NestJS: Load user preferences
   └─► users.work_start, work_end, timezone, penalty_matrix

4. NestJS: Bias blending
   └─► Query estimation_bias for each tag
   └─► Apply conservative max-bias to duration_minutes
   └─► Round up to nearest 15-min multiple

5. NestJS: Phase 1–2 (EDF)
   └─► Fetch all PENDING tasks in the scheduling horizon
   └─► Sort by deadline ASC, assign first available 15-min slot
   └─► Score slots: urgency_weight × time_to_deadline + penalty_matrix[index]

   NestJS: Phase 3+ (Bandit)
   └─► Build feature vector: [day, hours_to_deadline, load, …tags]
   └─► POST /predict to FastAPI
   └─► FastAPI returns recommended_start_time

6. NestJS: Cascade lock (Redis)
   └─► Acquire per-user lock for 500ms to prevent concurrent scheduler race

7. NestJS: Atomic DB write
   └─► INSERT task with scheduled_start_time
   └─► INSERT task_event (type: CREATE, reward_score: 1.0)
   └─► Release cascade lock

8. NestJS: Return task to client
   └─► 201 Created { task }
   └─► React Query cache invalidated → calendar re-renders
```

---

## Cascading Realignment

Triggered when a MOVE or new task creation would place a task into an occupied slot.

```
1. Detect collision: new task's [start, start+duration] overlaps with existing task's slot

2. If colliding task is fixed:
   └─► Cannot move it. Search forward in time for next open slot for the incoming task.

3. If colliding task is flexible:
   └─► Treat it as "evicted." Find next open slot for the evicted task.
   └─► This may cascade: the slot found might also be occupied → repeat.

4. Termination:
   └─► All tasks placed within work hours before their deadlines → success.
   └─► A task cannot be placed before its deadline → it enters Conflict state.
   └─► Write MOVE events for all displaced tasks.
```

The cascade loop is bounded by total slots in the horizon. For a 5-day week with 8 work hours/day and 15-min slots: 5 × 8 × 4 = 160 maximum iterations.

---

## Daily Bias Cron Job

Runs at 00:05 UTC. Processes the previous day's completed tasks.

```python
# Pseudocode
for user in users_with_activity:
    for tag in user.tags:
        events = task_events.filter(
            user_id=user.id,
            event_type='COMPLETE',
            occurred_at >= yesterday
        )
        samples = [(e.new_snapshot.duration / e.old_snapshot.duration) for e in events if tag in e.task.tags]
        if len(samples) >= 5:
            bias = mean(samples)
            upsert estimation_bias(user_id, tag, bias, len(samples))
```

---

## Deployment

```
VPS (single node — Phase 1–3)
├── nginx  (reverse proxy, TLS termination)
│   ├── / → React PWA static files
│   ├── /api → NestJS :3001
│   └── /ml → FastAPI :8000 (internal only via nginx allow list)
├── Docker Compose
│   ├── api       (NestJS)
│   ├── bandit    (FastAPI)
│   ├── postgres  (PostgreSQL 16)
│   └── redis     (Redis 7)
└── cron          (host cron → docker exec bias job)
```

Phase 4 migration: Move to managed PostgreSQL (Supabase/RDS), containerize cron into a dedicated worker process, expose bandit service via internal network only.

---

## Key Technical Choices

| Concern | Choice | Why |
|---|---|---|
| API framework | NestJS | Opinionated structure, Prisma-native, TypeScript |
| ORM | Prisma | Type-safe queries, migration tooling |
| ML runtime | FastAPI + numpy | Python ML ecosystem irreplaceable |
| Database | PostgreSQL 16 | `text[]` native, partitioning, JSONB |
| Cache | Redis | Session store + distributed lock |
| Frontend | Vite + React | Fast HMR, PWA support, mature ecosystem |
| State management | React Query (TanStack) | Server state sync, optimistic updates |
| Auth | JWT + refresh tokens | Stateless API, Redis blacklist for logout |
