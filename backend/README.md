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
│   │   ├── utils/             # PURE algorithm — no I/O, fully unit-tested
│   │   │   ├── edf.ts         # the EDF placement core
│   │   │   ├── slot.ts        # work-window math, 15-min slots, preference index
│   │   │   └── horizon.ts     # calendar math (period ceilings, work minutes)
│   │   └── scheduler.service.ts  # persistence wrapper around utils/ (+ telemetry)
│   ├── files/                 # multipart upload/download to local disk
│   ├── mail/                  # login email + Handlebars templates
│   ├── prisma/                # PrismaService + Postgres error-code map
│   └── common/                # constants, utils, validators, dto, types
├── compose.{local,dev,prod,test}.yml
├── Caddyfile.{local,prod}
├── Dockerfile
└── .env.{dev,prod,test} + docker.env
```

**Key layering rule:** `scheduler/utils/` is **pure and deterministic** (no
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
| `preferenceMatrix` | int[] | flat **672** ints (7 days × 96 fifteen-minute slots, slot-grid-aligned). **Signed** Phase-1 telemetry: a move-toward/keep increments a cell (+1), a move-away decrements it (−1), empty = 0 (neutral). **Not yet read** by the engine. Seeded lazily. |
| `durationAdjustmentMode` | `DurationAdjustmentMode` | `auto` \| `ask` \| `never`; default `auto`. Gates whether the Phase-2 per-tag duration corrector is *applied* (it always *learns*). |
| `preferenceMatrixDecayedAt` | DateTime? | When the daily decay cron last decayed `preferenceMatrix`; null until the first pass |
| `onboardingComplete` | bool | gates the onboarding redirect |

### `Task`
| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid | PK |
| `title`, `note` | string | `note` is rich text (TipTap) |
| `durationMinutes` | int | **always a positive multiple of 15** |
| `deadline` | DateTime? | EDF ordering key (nulls last) |
| `tags` | `Tag[]` | implicit many-to-many with `Tag` (per-user labels) |
| `manuallyMoved` | bool | true → the user dragged/resized this task. **Purely informational** (drives the "Manually placed" badge/telemetry) — the scheduler never reads it to decide what can move; see "The EDF engine" below for the continuous cost model that replaced the old hard freeze |
| `startTime` | int | minutes from midnight of the last manual placement; informational only, not consulted by the scheduler |
| `status` | `TaskStatus` | `PENDING` \| `DONE` \| `ABANDONED` |
| `conflict` | bool | true when the task has no valid placement (no slot before its deadline) — i.e. `scheduledStartTime` is null |
| `scheduledStartTime` | DateTime? | placement assigned by the EDF engine |
| `userId` | uuid | FK → `User`, `onDelete: Cascade` |

Indexes: `[userId, deadline]`, `[userId, status]`, `[userId, scheduledStartTime]`.

### `TaskEvent` (append-only audit trail — the ML fuel)
| Field | Type | Notes |
|-------|------|-------|
| `id` | BigInt | autoincrement (serialized as decimal string over the wire) |
| `eventType` | `TaskEventType` | `CREATE` \| `MOVE` \| `RESIZE` \| `KEEP` \| `COMPLETE` \| `ABANDON` \| `RESCHEDULED`. `KEEP` = completed in the suggested slot (positive signal); `RESCHEDULED` = auto-repositioned as collateral in someone else's cascade (not a user drag). |
| `oldSnapshot` / `newSnapshot` | Json | `{ scheduledStartTime, durationMinutes, tags }` (tag names at event time); MOVE/RESIZE also carry `suggestedStartTime` (the overridden EDF slot); RESCHEDULED carries `propensity` when the softmax re-ranker actually chose the slot. `oldSnapshot` null on CREATE/KEEP. |
| `rewardScore` | float | Phase-3 reward signal (default 1.0) |
| `occurredAt` | DateTime | indexed desc per user |
| `batchId` | string? | groups every RESCHEDULED event one `SchedulerService.reoptimize` auto-cascade wrote, so the whole batch can be undone atomically via `SchedulerService.undoBatch` / `POST /tasks/reschedule/undo/:batchId`. Null outside a reoptimize batch. Indexed `[userId, batchId]`. |
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

> **Tasks are one-off, and every task is flexible.** A `POST /tasks` always creates
> exactly one `Task` row, always EDF-placed (no more "fixed" tasks — that isn't the point
> of a smart scheduler). There is no hard "don't move this" flag anymore — see "The EDF
> engine" below for the continuous cost model that replaced it. There is no recurrence: no
> `rrule`, no `seriesId`, no `scope`. True recurrence may be reintroduced later as a
> deliberate feature on top of this simplified scheduler.

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
| PUT | `/users/me/preferences` | update work hours/days/timezone (+ optional `durationAdjustmentMode`) — **triggers a full EDF reschedule of all PENDING tasks** |
| POST | `/users/me/onboarding` | finish onboarding (sets schedule + optional `durationAdjustmentMode`) |
| GET | `/users/me/preference-matrix` | the current user's flat 672-int signed preference matrix for the Insights heatmap (`PreferenceMatrixResponse`; cold-start → all-zero). Read-only |

### Tasks (`/tasks`)
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/tasks` | create a single task — always flexible, always EDF-placed (`durationMinutes` is a plain required field; there is no more `fixed`/`startTime`/`endTime`). The new task enters the SAME unified `reoptimize` pass as every other pending task (see "The EDF engine" below); since it starts with no anchor, placing it well can legitimately nudge a far-out, cost-cheap-to-move task out of the way — a create is no longer guaranteed "solo". Only comes back unplaced (`conflict: true`) in the rare genuinely-saturated-calendar case |
| GET | `/tasks?view=&date=&status=` | list within the view window (+ unplaced conflicts) |
| GET | `/tasks/suggestions?q=&limit=` | title-autocomplete: the user's existing tasks, **newest first** and **deduped by title** (case-insensitive), optionally filtered by the `q` substring. `limit` 1–50, default 10. Returns `TaskSuggestionsResponse` (`{ suggestions: Task[] }`). Read-only; never reschedules. Declared **before** `/tasks/:id` so it isn't matched as an id |
| GET | `/tasks/:id` | task detail + last events |
| PATCH | `/tasks/:id` | metadata only (title/note/deadline/tags) saved immediately. A `deadline`/duration-correcting `tags` change that leaves the task's own slot no longer cost-optimal (past its new deadline, or overlapping a neighbor) is auto-resolved **inline, in the same request** via `SchedulerService.reoptimize` — `UpdateTaskResponse.displaced`/`batchId` surface what moved; `task` always reflects the FINAL slot, even when the edit itself cost-forced the edited task's own placement to move (the bug a tightened deadline used to silently violate). `deadlineChanged` is informational only |
| PATCH | `/tasks/:id/reschedule` | manual drag → pin (`manuallyMoved: true`, informational only), records MOVE + signed preference telemetry, then **inline** `reoptimize` of anything the drop now overlaps. Returns `RescheduleResponse` with `displaced`/`batchId` |
| PATCH | `/tasks/:id/resize` | edge-resize, snaps to 15-min grid, pins `manuallyMoved: true` (informational), then the same inline `reoptimize` `reschedule` uses |
| POST | `/tasks/reschedule/undo/:batchId` | undo one `reoptimize` batch (from `create`/`update`/`reschedule`/`resize`'s `batchId`): reverts every task it displaced back to its prior slot/duration, restored from each tagged `RESCHEDULED` `TaskEvent`'s `oldSnapshot`. 404 when `batchId` matches no event for this user. Returns `UndoBatchResponse` (`{ displaced: DisplacedTask[] }`) |
| PATCH | `/tasks/:id/complete` | mark DONE, records COMPLETE |
| DELETE | `/tasks/:id` | delete the task, then **inline** `reoptimize` to close whatever gap it left behind — no separate confirm step. Returns `RemoveTaskResponse` (`{ displaced: DisplacedTask[], batchId? }`), the same cascade-transparency shape `update`/`reschedule`/`resize` return |

> **`POST /tasks/reschedule-cascade` is gone.** It used to be the shared wide
> confirm-before-reschedule fallback (±3 workdays, a manual "reschedule everyone /
> reschedule only auto-scheduled tasks" choice) for whenever the narrow auto-resolve
> couldn't find room, chiefly because a manually-moved neighbor was in the way and the old
> model refused to touch it. That whole "ask before moving other tasks" step is gone: with
> the continuous cost model below there's no more manual/auto distinction to ask about, and
> every mutation already reoptimizes the user's FULL pending schedule inline (no more
> window-scoped "narrow" cascade either) — a second, wider confirm call is redundant. Along
> with it, `RescheduleCascadeInput`/`RescheduleCascadeDto` and `TasksService.
> rescheduleCascade` were removed from `@zenflow/shared` and the backend.
>
> **The continuous cost model (replaces the old hard `manuallyMoved` freeze + hard deadline
> cutoff + 3-tier fallback + view-scoped cascade).** See "The EDF engine" below for the full
> `placementCost` breakdown; the summary: EVERY non-past task's tolerance for being moved now
> scales continuously with how far in the future its current `scheduledStartTime` (its
> "anchor") sits — near-term anchors are expensive to move, far-future ones are cheap — and a
> tightened deadline or an off-hours slot is a cost penalty rather than a hard wall. The ONLY
> hard rules left: no two tasks may ever overlap, and a task already started/elapsed
> (`isPast`) is completely frozen. `manuallyMoved` plays no role in any of this anymore — it's
> purely informational (the "Manually placed" badge/telemetry).
>
> **`SchedulerService.reoptimize(userId, prefs, now, db?, opts?)`** is the single cascade
> primitive behind every mutation now (`create`/`update`/`reschedule`/`resize`/`remove`,
> collapsing the old `cascadeReschedule` + `narrowResolve` into one method): it loads ALL of
> this user's PENDING tasks (bounded only by the existing `MAX_SCAN_DAYS` query ceiling — no
> more window scoping), runs the pure cost-aware `scheduleAll`, recomputes true pairwise
> conflicts, diffs against the DB, and writes back every changed row in one statement. A
> fresh `batchId` is generated every call and stamped on every RESCHEDULED event it writes,
> so `undoBatch` can always revert a call's collateral moves — reported as `null` when
> nothing actually moved. `opts.fixedTaskId` marks a task whose own placement event is the
> CALLER's to log (e.g. `create`'s own CREATE event) so `reoptimize` doesn't double-log it as
> a collateral RESCHEDULED.

### Tags (`/tags`)
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/tags` | list the current user's tags (`{ tags: { id, name }[] }`, name-sorted) for the combobox |

### Files (`/files`)
`POST /files/upload` (multipart, ≤100 MB × 5), `POST /files/remove`,
`GET /files/metadata/:id`, `GET /files/:id` (download stream).

Full live schema: **Swagger UI at `<API_URL>/api`**.

## The EDF engine

Source: [`src/scheduler/utils/edf.ts`](src/scheduler/utils/edf.ts) (pure) +
[`scheduler.service.ts`](src/scheduler/scheduler.service.ts) (persistence). Tasks are placed
into 15-minute-grid slots. Placement is governed by a single continuous, cost-based
soft-constraint model — there is no more hard `manuallyMoved` freeze, hard deadline cutoff,
or window-scoped cascade (CLAUDE.md invariant #2's redesign).

### The cost model

For a task `t` currently anchored at `anchor(t)` — its stored `scheduledStartTime`,
literally wherever it sits right now, regardless of whether a human dragged it there or the
algorithm placed it — being evaluated at candidate slot `c`:

```
cost(t, c) = deviationCost(t, c) + latenessCost(t, c) + offHoursCost(c) − preferenceBonus(c)

deviationCost(t, c)  = deviationWeight(t) × |c.start − anchor(t)|      (minutes)
deviationWeight(t)   = lerp(DEVIATION_WEIGHT_NEAR, DEVIATION_WEIGHT_FAR,
                             clamp((anchor(t) − now) / (DEVIATION_HORIZON_DAYS days), 0, 1))
latenessCost(t, c)   = LATENESS_RATE × max(0, c.end − deadline(t))    (0 if no deadline)
offHoursCost(c)      = HOURS_RATE × minutesOutsideWorkWindow(c)
preferenceBonus(c)   = the signed preference-matrix cell score for c (reranker.ts's `cellScore`)
```

A task with **no anchor** (brand new, or currently unplaced) has `deviationCost = 0` for
every candidate — nothing to preserve, it's placed purely by the other terms. All five
constants live in [`constants.ts`](src/scheduler/constants.ts) (`DEVIATION_HORIZON_DAYS = 7`,
`DEVIATION_WEIGHT_NEAR = 1.0`, `DEVIATION_WEIGHT_FAR = 0.1`, `LATENESS_RATE = 4`,
`HOURS_RATE = 2`) — v1 defaults, deliberately plain, tunable later.
`LATENESS_RATE > HOURS_RATE` is deliberate: deadline pressure must keep beating work-hours
preference (the priority the old 3-tier fallback used to enforce structurally is now an
emergent property of these weights).

**What stays hard** (not part of the blend, no exceptions): (1) no two tasks may ever
overlap; (2) a task whose placement has already started/elapsed (`isPast(task, now)` —
`scheduledStartTime <= now`) is completely frozen — the floor of the deviation curve, not a
tunable weight. Everything else — the old deadline cutoff, the work-hours window, the
`manuallyMoved` freeze — is now just a cost term. `manuallyMoved` keeps its DB column (set on
a real drag/resize, surfaced for the "Manually placed" badge/telemetry) but the scheduler
never reads it to decide what can move.

### `scheduleAll(prefs, tasks, now, matrix?)`

The greedy, cost-aware EDF core. Non-past tasks are processed in EDF order (deadline
ascending, then `createdAt` — `compareMovable`, unchanged). The occupied baseline seeds from
**every** pending task's CURRENT placement (not just past ones) — this is what keeps an
already-good schedule stable: a task first checks whether its own anchor slot is still free
and cost-optimal (against a candidate pool pooled from three sources — `feasibleSlots`
in-hours-before-deadline, `findSlotIgnoringWorkHours` outside-hours-before-deadline,
`findNextAvailableSlot` in-hours-past-deadline — no more priority tiering between them, cost
alone decides) and, if so, is kept unmoved. If its cheapest candidate collides with a
not-yet-processed (lower-or-equal-priority) task's anchor, a **single-level bounded
eviction** decides whether to bump it: compare (the incoming task's cost taking its own
next-best genuinely-free slot) against (its cost at the contested slot + the occupant's own
relocation cost) — ties favor eviction (the task currently being placed is the higher-
priority one), but never when the occupant has nowhere to go at all. This never cascades — an
evicted task always relocates to its own next-best free candidate, never triggering a second
eviction. A task placeable by none of the sources (including its own eviction-relocation
attempt) comes back `{ scheduledStartTime: null, conflict: true }` — a rare,
genuinely-saturated-calendar case. Near-ties among comparably-costed candidates are broken by
the same seeded-softmax stochastic mechanism `reranker.ts` uses (`rankByScores`, fed
`-placementCost` instead of a preference-only score), so IPS/propensity logging keeps
working; candidates far from the true minimum are excluded from that ranking pool entirely
(pooling them in would let Gumbel noise occasionally hand the placement to a much-worse
fallback candidate, and would corrupt the deterministic earliest-first tie-break among
genuinely-tied ones).

### Other pure pieces

- **`feasibleSlots(task, now, prefs, occupied, earliestStart?)`** — every 15-min-grid
  in-work-hours start before the task's deadline (or `now + MAX_SCAN_DAYS` with no deadline)
  that doesn't overlap `occupied`, ascending. Cross-midnight-aware via `workWindowFor`.
- **`findSlotIgnoringWorkHours(task, now, occupied, prefs, ceiling?)`** — a candidate ignoring
  the work-hours window (still respecting `occupied` and an optional deadline `ceiling`),
  preferring the gap closest to that day's work window.
- **`findNextAvailableSlot(task, searchFrom, occupied, prefs)`** — the earliest in-work-hours
  slot at/after `searchFrom`, ignoring the deadline entirely (the "deadline actually missed"
  case).
- **`fallbackSlot(task, now, occupied, prefs)`** — chains the two above into a single
  best-effort candidate for a not-yet-created draft task (no anchor to weigh against, so it
  doesn't need `scheduleAll`'s full cost-scored candidate pool). No current caller —
  previously wired to the now-removed `SchedulerService.simulate()` preview
  (`POST /tasks/simulate` was deleted along with the preview-before-commit flow; see
  [`docs/heuristic.md`](../docs/heuristic.md)'s overflow-recovery note).
- **`isPast(task, now)`** — the one hard freeze (see above).
- **`compareMovable(a, b)`** — deadline ascending (nulls last), then `createdAt` ascending.

### Conflict detection

Pure pairwise interval overlap over **all placed tasks**, independent of `now`/elapsed/past.
`recomputeConflicts` (in `telemetry.ts`) recomputes the `conflict` flag for every placed task
after each `reoptimize` pass; unplaced tasks (no valid slot at all) keep `conflict: true`.

`SchedulerService` wraps the pure core to persist placements (`persistPlacements`, one raw
`UPDATE … FROM (VALUES …)` per cascade — never N sequential `task.update` calls, which used
to blow the 5s interactive-transaction budget), write `TaskEvent`s, and apply signed updates
to `preferenceMatrix` (move-away −1, move-toward/keep +1). A `scoreSlot()`-shaped seam is
reserved here for the **Phase 3 bandit** to plug into (see
[`services/bandit/README.md`](../services/bandit/README.md) and
[`docs/heuristic.md`](../docs/heuristic.md)).

### Phase 2 — personalized scheduling (live)

The matrix/bias/decay are computed in the **service** and passed into the **pure** core
(invariant #2). The pure pieces (`reranker.ts`, `duration-bias.ts`, `matrix-decay.ts`) take
inputs as params and do no I/O; the service is the only thing that reads Prisma.

- **Placement re-ranker** (`reranker.ts` → `rankCandidates`/`cellScore`/`rankByScores`): the
  shared softmax/Gumbel stochastic-logging mechanism. `scheduleAll`'s cost-scored candidate
  ranking uses `rankByScores` directly (fed `-placementCost` instead of a raw preference score
  — see "The EDF engine" above); `rankCandidates`/`pickBest`/`topN` are the preference-only
  variant, currently unused now that `SchedulerService.simulate()` (their only caller) has been
  removed — see `docs/heuristic.md`'s overflow-recovery note. `SchedulerService.reoptimize`
  builds the matrix from `user.preferenceMatrix`. A cold-start / wrong-length matrix, or a
  genuine tie, degenerates to deterministic earliest-first order with uniform propensity
  rather than injecting noise.
- **Duration corrector** (`duration-bias.ts` → `blendBias` / `correctDuration`):
  `SchedulerService.computeDurationCorrection` aggregates per-tag `{ n, b }` from `TaskEvent`
  telemetry (rolling `actual ÷ estimated`), blends it sample-weighted, and rounds the
  corrected duration **up** to the 15-min grid. `TasksService.create` applies it as
  preprocessing **before** EDF — gated by `user.durationAdjustmentMode`: `never` feeds the
  uncorrected estimate to EDF but **still learns** the bias. The real `biasApplied`,
  `estimatedDuration`, `durationAdjustmentMode`, and `durationReason` are surfaced on the
  create response's `schedulingMeta`.
- **Rationale** (`rationale.ts` → `buildRationale`): a human-readable summary
  (`schedulingMeta.rationale` / `RescheduleResponse.rationale`) describing the preferred work
  window + top cells that drove a placement (omitted when it wasn't preference-favoured). Its
  only current wiring was `SchedulerService.simulate()`'s draft-task preview, now removed
  along with `POST /tasks/simulate`; `displace()`/`resize()` still return the field
  (hard-coded `null` today).
- **Matrix-decay cron** (`matrix-decay.service.ts`, `@Cron` daily): the I/O wrapper loads each
  user's `preferenceMatrix` + `preferenceMatrixDecayedAt`, calls the pure `decayMatrix`
  (`cell *= 2^(−Δdays / MATRIX_HALF_LIFE_DAYS)`, 21-day half-life), and writes back.

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
SESSION_TTL_MS=604800000                       # optional; idle session lifetime, defaults to 7 days
COOKIE_SECURE=true                             # optional; Secure cookie flag, defaults to true
COOKIE_SAMESITE=lax                            # optional; lax | none | strict, defaults to lax
GRPC_SCHEDULER_URL="zenflow-scheduler:50051"   # reserved for the future ML service
```

Sessions are **rolling**: every authenticated request resets the session cookie and the
Redis session TTL, so an actively-used session is extended on each call and won't expire
mid-use. `SESSION_TTL_MS` is therefore an *idle* timeout (cookie `maxAge` and Redis TTL are
kept in sync). The option building lives in `src/auth/session.config.ts` (pure, unit-tested).

**Session cookie flags (`COOKIE_SECURE` / `COOKIE_SAMESITE`).** These drive the session
cookie's `Secure` and `SameSite` attributes and are decoupled from `NODE_ENV`:

- **Dev / staging** (served over HTTP): `COOKIE_SECURE=false`, `COOKIE_SAMESITE=lax`.
- **Production** (served over HTTPS): `COOKIE_SECURE=true`. The current deployment serves the
  frontend at `https://zenflow.alphatrann.com` and the API at `https://zenflow-api.alphatrann.com`
  — both subdomains of `alphatrann.com`, i.e. **same-site** — so `COOKIE_SAMESITE=lax` is
  sufficient and preferred (Lax gives some CSRF protection that None gives up). These also match
  the built-in defaults (`COOKIE_SECURE=true`, `COOKIE_SAMESITE=lax`), so `.env.prod` needs no
  cookie overrides for this topology:

  ```env
  COOKIE_SECURE=true
  COOKIE_SAMESITE=lax
  CORS_ORIGIN="https://zenflow.alphatrann.com"   # EXACT frontend origin: scheme+host, no trailing slash
  ```

  `CORS_ORIGIN` must be the exact frontend origin (no trailing slash): credentialed requests
  (`credentials: true` in `main.ts`) require the server to echo back the precise `Origin`, not a
  wildcard.

  **Only if the frontend is moved to a cross-site origin** (e.g. a raw `*.netlify.app` domain that
  doesn't share the API's registrable domain) does the browser require `SameSite=None; Secure` to
  send the cookie cross-site — then set `COOKIE_SAMESITE=none` (with `COOKIE_SECURE=true`). Browsers
  reject `SameSite=None` cookies that aren't `Secure`, so `buildSessionOptions` throws at startup if
  `COOKIE_SAMESITE=none` is paired with `COOKIE_SECURE=false`.

  **The actual prod bug this guards against:** TLS is terminated at the Caddy reverse proxy, which
  forwards plain HTTP plus an `X-Forwarded-Proto: https` header. Without `trust proxy`, Express saw
  `req.secure === false` and express-session silently refused to emit the `Secure` cookie at all —
  so login "succeeded" but no session cookie ever reached the browser, causing a 403 on every
  subsequent request and a logout on reload. `main.ts` now sets `app.set("trust proxy", 1)` so
  Express trusts the forwarded proto and emits the cookie.

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
