# Zenflow API (backend)

NestJS service that owns persistence, auth, file storage, and the **Phase 1
Earliest-Deadline-First (EDF) scheduling engine**. Part of the
[Zenflow monorepo](../README.md) — start there for the big picture and quick start.

---

## Tech stack

| Concern | Choice |
|---------|--------|
| Framework | NestJS 11 (Express platform) |
| Language | TypeScript 5.7 (ES2023, `nodenext`) |
| ORM / DB | Prisma 6 + PostgreSQL |
| Sessions & cache | Redis (`connect-redis` sessions, `@nestjs/cache-manager` + keyv) |
| Auth | Passport `local` strategy used for **email OTP** (no passwords) |
| Scheduling/time | `luxon`, `date-fns` / `date-fns-tz` |
| Validation | `class-validator` + `class-transformer` (global `ValidationPipe`) |
| Mail | `@nestjs-modules/mailer` + nodemailer + Handlebars templates |
| API docs | `@nestjs/swagger` (served at `/api`) |
| Tests | Jest (unit `*.spec.ts`, e2e via `test/jest-e2e.json`) |
| Shared types | `@zenflow/shared` (`workspace:*`) — the FE/BE contract |

## Folder structure

```
backend/
├── prisma/
│   └── schema.prisma          # DB schema (client generated to ../generated/prisma)
├── src/
│   ├── main.ts                # bootstrap: global prefix /api/v1, CORS, ValidationPipe,
│   │                          #   Redis session, passport, Swagger at /api
│   ├── app.module.ts          # root module wiring
│   ├── auth/                  # OTP request/verify, Passport local strategy, guards
│   │   ├── guards/            # CookieAuthGuard (session), LocalAuthGuard (OTP login)
│   │   ├── strategies/        # local.strategy.ts (email + otp)
│   │   ├── serializers/       # session (de)serialization
│   │   └── utils/             # generate-otp, hide-email (+ *.spec.ts)
│   ├── users/                 # profile, preferences, onboarding
│   │   └── decorators/        # @CurrentUser()
│   ├── tasks/                 # task CRUD, reschedule, resize, complete
│   ├── scheduler/             # the engine (see below)
│   │   ├── edf.ts             # PURE algorithm — no I/O, fully unit-tested
│   │   ├── slot.ts            # work-window math, 15-min slots, penalty index
│   │   ├── horizon.ts         # calendar math (view ranges, week/month, work minutes)
│   │   └── scheduler.service.ts  # persistence wrapper around edf.ts (+ telemetry)
│   ├── files/                 # multipart upload/download to local disk
│   ├── mail/                  # login email + Handlebars templates
│   ├── prisma/                # PrismaService + Postgres error-code map
│   └── common/                # constants, utils, validators, dto, types
├── compose.{local,dev,prod,test}.yml
├── Caddyfile.{local,prod}
├── Dockerfile
└── .env.{dev,prod,test} + docker.env
```

**Key layering rule:** `scheduler/edf.ts` is a **pure, deterministic** module (no
database, no clock, no randomness — `now` is always passed in). `SchedulerService`
is the only thing that touches Prisma and records telemetry. Keep that split: it's
what makes the engine unit-testable and what Phase 3 will plug into.

## Database schema

Defined in [`prisma/schema.prisma`](prisma/schema.prisma). Five models.

### `User`
| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid | PK |
| `name`, `email` | string | `email` unique |
| `timezone` | string | IANA, default `"UTC"` |
| `workStart` / `workEnd` | int | minutes from midnight (default 540 / 1020 = 09:00–17:00) |
| `workDays` | int[] | ISO weekdays, default `[1,2,3,4,5]` (1=Mon … 7=Sun) |
| `penaltyMatrix` | int[] | flat **336** ints (7 days × 48 half-hour slots). Written on MOVE as Phase-1 telemetry; **not yet read** by the engine. Seeded lazily. |
| `roleArchetypeId` | string? | Phase-4 cold-start cluster id |
| `onboardingComplete` | bool | gates the onboarding redirect |

### `Task`
| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid | PK |
| `title`, `note` | string | `note` is rich text (TipTap) |
| `durationMinutes` | int | **always a positive multiple of 15** |
| `deadline` | DateTime? | EDF ordering key (nulls last) |
| `tags` | `Tag[]` | implicit many-to-many with `Tag` (per-user labels) |
| `fixed` | bool | true → immovable anchor at `startTime` |
| `startTime` | int | minutes from midnight; only meaningful when `fixed` |
| `status` | `TaskStatus` | `PENDING` \| `DONE` |
| `conflict` | bool | true when the task has no valid placement (no slot before its deadline) — i.e. `scheduledStartTime` is null |
| `scheduledStartTime` | DateTime? | placement assigned by the EDF engine |
| `userId` | uuid | FK → `User`, `onDelete: Cascade` |

Indexes: `[userId, deadline]`, `[userId, status]`, `[userId, scheduledStartTime]`.

### `TaskEvent` (append-only audit trail — the ML fuel)
| Field | Type | Notes |
|-------|------|-------|
| `id` | BigInt | autoincrement (serialized as decimal string over the wire) |
| `eventType` | `TaskEventType` | `CREATE` \| `MOVE` \| `RESIZE` \| `COMPLETE` |
| `oldSnapshot` / `newSnapshot` | Json | `{ scheduledStartTime, durationMinutes }`; `oldSnapshot` null on CREATE |
| `rewardScore` | float | Phase-3 reward signal (default 1.0) |
| `occurredAt` | DateTime | indexed desc per user |
| `taskId` / `userId` | uuid | FKs, cascade delete (`userId` denormalized for range queries) |

### `Tag`
Per-user label in an implicit many-to-many with `Task`.
| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid | PK |
| `name` | string | unique per user (`@@unique([userId, name])`) |
| `userId` | uuid | FK → `User`, `onDelete: Cascade` |
| `createdAt` | DateTime | |

On task create/update the backend resolves an incoming array of tag **names**:
unknown names are upserted (per user) and all are connected to the occurrence(s),
atomically inside the task transaction. The wire format keeps `Task.tags` as a
`string[]` of names — the `Tag` table is a backend detail.

### `File`
`id`, `originalName`, `filename`, `path`, `mimetype`, `size`, `userId` (cascade).

> **Tasks are one-off.** A `POST /tasks` always creates exactly one `Task` row — fixed
> tasks anchor at `startTime`, flexible tasks are EDF-placed from `startDate` (or `now`).
> There is no recurrence: no `rrule`, no `seriesId`, no `scope`. True recurrence may be
> reintroduced later as a deliberate feature on top of this simplified scheduler.

## API endpoints

Global prefix **`/api/v1`**. All routes except `POST /auth/otp/*` require
`CookieAuthGuard` (a valid Redis session cookie). Success responses use the
`@zenflow/shared` envelope `{ success: true, message?, data }`; errors use
`{ success: false, message, statusCode?, field? }`.

### Auth (`/auth`)
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/auth/otp/request` | email a 6-digit OTP (no guard) |
| POST | `/auth/otp/verify` | verify OTP, create user if new, start session. Reads `x-timezone` header. (`LocalAuthGuard`) |
| GET | `/auth/me` | current user |
| POST | `/auth/logout` | destroy session |

### Users (`/users`)
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/users/me` | profile |
| PATCH | `/users/update/basic-info` | update name/email |
| PUT | `/users/me/preferences` | update work hours/days/timezone — **triggers a full EDF reschedule of all PENDING tasks** |
| POST | `/users/me/onboarding` | finish onboarding (sets schedule + optional role archetype) |

### Tasks (`/tasks`)
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/tasks` | create a single task (fixed anchors at `startTime`; flexible is EDF-placed). Accepts an optional `view` (`day`/`week`/`month`). When the task can't be placed before its deadline, the response carries an `overflow` block of recovery options |
| GET | `/tasks?view=&date=&status=` | list within the view window (+ unplaced conflicts) |
| GET | `/tasks/suggestions?q=&limit=` | title-autocomplete: the user's existing tasks, **newest first** and **deduped by title** (case-insensitive), optionally filtered by the `q` substring. `limit` 1–50, default 10. Returns `TaskSuggestionsResponse` (`{ suggestions: Task[] }`). Read-only; never reschedules. Declared **before** `/tasks/:id` so it isn't matched as an id |
| GET | `/tasks/:id` | task detail + last events |
| PATCH | `/tasks/:id` | metadata only (title/note/deadline/tags) — **does NOT reschedule** |
| PATCH | `/tasks/:id/reschedule` | manual drag → `pin`, records MOVE + penalty telemetry |
| PATCH | `/tasks/:id/resize` | edge-resize, snaps to 15-min grid, recomputes conflicts |
| PATCH | `/tasks/:id/resolve-overflow` | accept a create-overflow recovery option (`{ choice: "outsideHours"\|"nextAvailable", view? }`); re-derives the slot server-side, pins the task as a fixed anchor, records MOVE. Returns a `RescheduleResponse` |
| PATCH | `/tasks/:id/complete` | mark DONE, records COMPLETE |
| DELETE | `/tasks/:id` | delete the task |

> **Overflow recovery.** When `POST /tasks` returns a task with `scheduledStartTime: null`
> (no work-hours slot before its deadline), the response also carries
> `overflow: { outsideHours, nextAvailable }`. `outsideHours` is the earliest slot ignoring
> the work-hours window but still respecting occupied intervals **and** the deadline (null
> if even off-hours room runs out before the deadline); `nextAvailable` is the earliest
> work-hours slot in the next `view` period (day/week/month), **ignoring** the deadline. The
> user picks one and the frontend calls `PATCH /tasks/:id/resolve-overflow`, which recomputes
> the slot server-side (the client time is never trusted) and pins the task as a `fixed`
> anchor so the next cascade can't bounce it back to unplaced.

### Tags (`/tags`)
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/tags` | list the current user's tags (`{ tags: { id, name }[] }`, name-sorted) for the combobox |

### Files (`/files`)
`POST /files/upload` (multipart, ≤100 MB × 5), `POST /files/remove`,
`GET /files/metadata/:id`, `GET /files/:id` (download stream).

Full live schema: **Swagger UI at `<API_URL>/api`**.

## The EDF engine

Source: [`src/scheduler/edf.ts`](src/scheduler/edf.ts) (pure) +
[`scheduler.service.ts`](src/scheduler/scheduler.service.ts) (persistence). Tasks are
placed into contiguous 15-minute slots inside each `User`'s work window, respecting
deadlines.

Pure functions you'll work with:

- **`findSlot(prefs, durationMinutes, deadline, occupied, now, earliest?)`** — earliest
  contiguous work-hours slot of the required length that starts at/after `earliest`/`now`
  and ends before `deadline`; scans up to `MAX_SCAN_DAYS` (90); returns `null` on conflict.
- **`compareEdf(a, b)`** — the ordering: deadline ascending (nulls last), then `createdAt`.
- **`scheduleAll(prefs, tasks, now)`** — full deterministic re-EDF (fixed tasks stay put,
  flexible tasks EDF-packed around them). Used when preferences change.
- **`placeOne(prefs, task, others, now, earliest?)`** — incremental placement of one new
  task, preserving everyone else's (possibly hand-moved) placement. Used on `POST /tasks`.
- **`findSlotIgnoringWorkHours(durationMinutes, deadline, occupied, now)`**
  ([`overflow.ts`](src/scheduler/overflow.ts)) — earliest 15-min-grid slot from `now` that
  ignores the work-hours window/work days but still avoids `occupied` and ends ≤ `deadline`;
  `null` when even off-hours room runs out before the deadline. Backs the `outsideHours`
  recovery option.
- **`findNextAvailableSlot(prefs, durationMinutes, occupied, now, granularity)`**
  ([`overflow.ts`](src/scheduler/overflow.ts)) — earliest **work-hours** slot in the next
  period boundary (`day` → next working day, `week` → next week, `month` → next month),
  **ignoring** the deadline; reuses `findSlot`'s window/grid math via the boundary as its
  floor. Backs the `nextAvailable` recovery option. Both helpers stay pure (`now` in, no I/O);
  `SchedulerService.computeOverflowOptions` / `applyOverflowOption` are the persistence wrappers.
**Placement is `now`-aware; conflict detection is `now`-independent.** Keep these two axes
separate — they answer different questions:

- **`isPast(task, now)`** — `task.scheduledStartTime !== null && start < now`. **Past tasks'
  PLACEMENT is frozen**: no scheduling path ever moves or re-places them — `scheduleAll`
  passes them through with their stored `scheduledStartTime`, and `pin`/`resize` only ever
  write the dragged target's slot. An in-progress task (started before `now`, ends after) is
  frozen too — left exactly where it is. Note `isPast` no longer gates the **conflict**
  verdict: a past task's `conflict` flag IS recomputed (see below).
- **`hasElapsed(task, now)`** — `placed && start + duration <= now`. This — NOT `isPast` —
  decides whether a placed block still **occupies future time** and so must block new
  PLACEMENTS. Only a fully-elapsed block (ends at/before `now`) is excluded from the
  `occupied` set (`findSlot` clamps every candidate to `now`, so an elapsed block can never
  legitimately block a future slot). An **in-progress** frozen task is past but NOT elapsed:
  it is added to `occupied` so the EDF packer schedules around it. `hasElapsed` affects
  placement only — it no longer filters the conflict-overlap pass.

**Conflict detection** is pure pairwise interval overlap over **all placed tasks across the
whole viewed window, regardless of `now`/elapsed/past**. A conflict means simply "two tasks
overlap in time": a morning past–past or past–in-progress overlap is flagged and counted in
the header badge even when it's now the afternoon, and a conflict self-heals to `false` the
moment the overlap is gone. Both `scheduleAll`'s final overlap pass and the
`recomputeConflicts` helper recompute the `conflict` flag for **every** placed task
(anchors, freshly packed flexible tasks, and frozen past/in-progress ones); only
`scheduledStartTime` stays frozen for past/anchored tasks. Unplaced tasks (no slot before
their deadline) keep `conflict: true`. (Placement clamps new live slots to `>= now`, so a
live/future task can never overlap a fully-elapsed one — making detection now-independent
introduces no false positives; the only newly-flagged overlaps are genuine past–past /
past–in-progress ones.)

`SchedulerService.pin`/`resize` (manual drag/drop and edge-resize) place a task exactly
where the user dropped it — no cascade — and recompute every task's conflict from real
time-overlap via the shared `recomputeConflicts(projected)` helper. This is the only path
that can leave a task **placed but conflicting** (overlapping a neighbour); the EDF engine
itself only ever leaves a task unplaced (`scheduledStartTime: null`) on conflict.

`SchedulerService` wraps these to persist placements, write `TaskEvent`s, and bump the
`penaltyMatrix`. A `scoreSlot()` seam is reserved here for the **Phase 3 bandit** to plug
into (see [`services/bandit/README.md`](../services/bandit/README.md) and
[`docs/heuristic.md`](../docs/heuristic.md)).

> When you change any pure scheduler function, update its `*.spec.ts` in the same change
> (`edf.spec.ts`, `horizon.spec.ts`) and run `pnpm --filter backend test`.

## Conventions

- **Naming:** plural feature folders/classes (`TasksController`, `UsersService`,
  `TasksModule`). DTOs end in `Dto`; guards in `Guard`; strategies in `Strategy`.
- **DTOs + validation:** every request body/query is a `class-validator` DTO. The global
  pipe runs `whitelist: true, forbidNonWhitelisted: true, transform: true` with implicit
  conversion — so unknown fields are rejected and query params coerce to their typed shape.
  Custom decorators: `@IsValidTimezone()`, plus `@CurrentUser()`.
- **Response shape:** controllers return `{ success: true, message, data }`; let NestJS
  `HttpException`s propagate (don't swallow). Prisma errors map via
  [`src/prisma/error-codes.ts`](src/prisma/error-codes.ts).
- **Shared types are the contract:** request/response shapes live in `@zenflow/shared`
  (`CreateTaskInput`, `TasksListResponse`, `RescheduleResponse`, …). Change types there and
  `pnpm shared:build` before relying on them.
- **Module wiring:** a feature module imports `PrismaModule` when it needs the DB;
  `SchedulerModule` is imported by `TasksModule` and `UsersModule`.

## Local development

```bash
# From repo root, once:
pnpm install && pnpm shared:build

# Backend scripts (run inside backend/, or `pnpm --filter backend <script>`):
pnpm start:dev            # watch-mode Nest server
pnpm typecheck           # tsc --noEmit
pnpm lint                # eslint --fix
pnpm test                # jest unit tests (*.spec.ts)
pnpm test:e2e            # jest e2e (needs .env.test DB)

# Prisma (dev DB via .env.dev):
pnpm prisma:dev:migrate  # create/apply a migration
pnpm prisma:dev:studio   # browse the DB
pnpm prisma:gen:dev      # regenerate the Prisma client → ../generated/prisma
```

### Environment

`.env.{dev,prod,test}` hold app config; `docker.env` holds Postgres credentials for
Compose. Required app vars (validated at boot via `@hapi/joi`):

```env
DATABASE_URL="postgres://admin:admin@zenflow-db:5432/zenflow?schema=public"
CACHE_URL="redis://zenflow-cache:6379"
CORS_ORIGIN="http://localhost:5173"
MAIL_TRANSPORT="smtp://zenflow-mail:25"
SESSION_SECRET="change-me"
GRPC_SCHEDULER_URL="zenflow-scheduler:50051"   # reserved for the future ML service
```

### Docker

`compose.local.yml` brings up `api` (:5000), `postgres`, `redis`, `mail` (MailHog —
catches OTP emails), the reserved `scheduler` service, and a `caddy` reverse proxy.

```bash
sh build_images.sh
docker compose up -d        # API → :5000, Swagger → :5000/api
```

The Dockerfile is a multi-stage `node:20-alpine` build; `start:prod` runs
`prisma migrate deploy` before launching `dist/main`.

## Contributing

- **Formatter:** ESLint + Prettier (via `eslint-plugin-prettier`) — `pnpm --filter backend lint`
  runs `eslint --fix`. **2-space** indentation, double quotes, semicolons
  ([`.editorconfig`](../.editorconfig)).
- **Commits:** [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/),
  e.g. `feat(scheduler): …`, `fix(tasks): …`, `test(backend): …`.

See the repo-wide **[CONTRIBUTING.md](../CONTRIBUTING.md)** for setup, branching, and testing.
