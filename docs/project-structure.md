# Project Structure

Zenflow is a pnpm monorepo. Packages are co-located for type-sharing and atomic deployments.

---

## Directory Tree

```
zenflow/
│
├── apps/
│   ├── web/                          # React PWA (Vite + TypeScript)
│   │   ├── src/
│   │   │   ├── components/
│   │   │   │   ├── calendar/
│   │   │   │   │   ├── DayView.tsx
│   │   │   │   │   ├── WeekView.tsx
│   │   │   │   │   ├── MonthView.tsx
│   │   │   │   │   ├── TaskCard.tsx
│   │   │   │   │   ├── TimeGrid.tsx
│   │   │   │   │   └── NowIndicator.tsx
│   │   │   │   ├── panels/
│   │   │   │   │   ├── TaskCreatePanel.tsx
│   │   │   │   │   └── TaskDetailPanel.tsx
│   │   │   │   ├── sidebar/
│   │   │   │   │   ├── Sidebar.tsx
│   │   │   │   │   ├── DayLoadBar.tsx
│   │   │   │   │   └── AgendaQueue.tsx
│   │   │   │   └── ui/               # shadcn/ui primitives
│   │   │   ├── hooks/
│   │   │   │   ├── useDragTask.ts
│   │   │   │   ├── useResizeTask.ts
│   │   │   │   └── useSchedule.ts
│   │   │   ├── lib/
│   │   │   │   ├── api.ts            # React Query + axios client
│   │   │   │   ├── time.ts           # Work hours, slot math helpers
│   │   │   │   └── rrule.ts          # RFC 5545 expansion helpers
│   │   │   ├── pages/
│   │   │   │   ├── Onboarding.tsx
│   │   │   │   └── Dashboard.tsx
│   │   │   ├── store/
│   │   │   │   └── viewStore.ts      # Active view + date (Zustand)
│   │   │   ├── styles/
│   │   │   │   └── globals.css       # Design system CSS vars
│   │   │   └── main.tsx
│   │   ├── public/
│   │   │   ├── manifest.json
│   │   │   └── sw.js                 # Service worker (offline reads)
│   │   ├── index.html
│   │   ├── vite.config.ts
│   │   └── package.json
│   │
│   └── api/                          # NestJS application
│       ├── src/
│       │   ├── auth/
│       │   │   ├── auth.module.ts
│       │   │   ├── auth.controller.ts
│       │   │   ├── auth.service.ts
│       │   │   ├── jwt.strategy.ts
│       │   │   └── guards/
│       │   ├── users/
│       │   │   ├── users.module.ts
│       │   │   ├── users.controller.ts
│       │   │   └── users.service.ts
│       │   ├── tasks/
│       │   │   ├── tasks.module.ts
│       │   │   ├── tasks.controller.ts
│       │   │   ├── tasks.service.ts
│       │   │   └── dto/
│       │   │       ├── create-task.dto.ts
│       │   │       └── reschedule-task.dto.ts
│       │   ├── scheduler/
│       │   │   ├── scheduler.service.ts  # EDF engine + cascade logic
│       │   │   ├── bandit.client.ts      # FastAPI HTTP client
│       │   │   └── penalty.service.ts    # Matrix read/write
│       │   ├── events/
│       │   │   └── events.service.ts     # task_events writes
│       │   ├── bias/
│       │   │   └── bias.cron.ts          # Daily estimation bias job
│       │   ├── prisma/
│       │   │   └── prisma.service.ts
│       │   └── main.ts
│       ├── prisma/
│       │   ├── schema.prisma
│       │   └── migrations/
│       └── package.json
│
├── services/
│   └── bandit/                       # FastAPI ML microservice
│       ├── app/
│       │   ├── main.py
│       │   ├── routers/
│       │   │   ├── predict.py        # POST /predict
│       │   │   ├── update.py         # POST /update (reward feedback)
│       │   │   └── seed.py           # POST /seed (archetype cold-start)
│       │   ├── models/
│       │   │   ├── linucb.py         # LinUCB implementation
│       │   │   └── archetype.py      # Collaborative filtering
│       │   └── schemas.py            # Pydantic request/response models
│       ├── requirements.txt
│       └── Dockerfile
│
├── packages/
│   └── types/                        # Shared TypeScript types
│       ├── src/
│       │   ├── task.ts               # Task, TaskEvent, TaskStatus
│       │   ├── user.ts               # User, UserPreferences
│       │   └── api.ts                # API response envelopes
│       └── package.json
│
├── infra/
│   ├── docker-compose.yml            # Local dev environment
│   ├── docker-compose.prod.yml
│   ├── nginx/
│   │   └── nginx.conf
│   └── scripts/
│       └── create-partition.sql      # Monthly partition creation
│
├── docs/                             → v2/ (this wiki)
│
├── pnpm-workspace.yaml
├── package.json
└── turbo.json                        # Turborepo build pipeline
```

---

## Module Ownership

| Area | Package | Key files |
|---|---|---|
| EDF scheduling | `apps/api/src/scheduler/` | `scheduler.service.ts` |
| Cascade realignment | `apps/api/src/scheduler/` | `scheduler.service.ts` |
| Penalty matrix | `apps/api/src/scheduler/` | `penalty.service.ts` |
| Bandit predictions | `services/bandit/` | `routers/predict.py`, `models/linucb.py` |
| Estimation bias | `apps/api/src/bias/` | `bias.cron.ts` |
| Drag-and-drop | `apps/web/src/hooks/` | `useDragTask.ts` |
| Time math | `apps/web/src/lib/` | `time.ts` |

---

## Environment Variables

```bash
# apps/api
DATABASE_URL=postgresql://zenflow:pass@localhost:5432/zenflow
REDIS_URL=redis://localhost:6379
JWT_SECRET=...
JWT_REFRESH_SECRET=...
BANDIT_SERVICE_URL=http://localhost:8000

# services/bandit
DATABASE_URL=postgresql://zenflow:pass@localhost:5432/zenflow

# apps/web
VITE_API_BASE_URL=http://localhost:3001/api/v1
```

---

## Scripts

```bash
pnpm dev           # Start all services in parallel (Turbo)
pnpm build         # Build all packages
pnpm lint          # Lint all packages
pnpm typecheck     # Run tsc across all TypeScript packages
pnpm test          # Unit + integration tests
pnpm db:migrate    # Run Prisma migrations
pnpm db:seed       # Seed development data
```
