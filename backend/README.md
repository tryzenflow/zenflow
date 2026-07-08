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
│   │   ├── slot.ts            # work-window math, 15-min slots, preference index
│   │   ├── horizon.ts         # calendar math (view ranges, week/month, work minutes)
│   │   └── scheduler.service.ts  # persistence wrapper around edf.ts (+ telemetry)
│   ├── simulation/            # persona simulator (synthetic telemetry — see below)
│   │   ├── rng.ts             # PURE seeded PRNG (mulberry32) + sampling helpers
│   │   ├── clock.ts           # PURE virtual clock over the ~1-year span
│   │   ├── personas/          # archetypes, persona factory, preference field (PURE)
│   │   ├── behavior/          # task generator + reaction policy (PURE)
│   │   ├── runner.ts          # closed loop — drives the REAL Tasks/Scheduler services
│   │   ├── run.ts             # `sim:run` entry (standalone Nest context)
│   │   └── eval/              # MAR + metrics, IPS/SNIPS replay scaffold
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
| `preferenceMatrix` | int[] | flat **672** ints (7 days × 96 fifteen-minute slots, slot-grid-aligned). **Signed** Phase-1 telemetry: a move-toward/keep increments a cell (+1), a move-away decrements it (−1), empty = 0 (neutral). **Not yet read** by the engine. Seeded lazily. |
| `durationAdjustmentMode` | `DurationAdjustmentMode` | `auto` \| `ask` \| `never`; default `auto`. Gates whether the Phase-2 per-tag duration corrector is *applied* (it always *learns*). |
| `preferenceMatrixDecayedAt` | DateTime? | When the daily decay cron last decayed `preferenceMatrix`; null until the first pass |
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
| `manuallyMoved` | bool | true → the user dragged/resized this task (or accepted an overflow-recovery slot); the ONLY "don't move this" mechanism — there is no more `fixed` task concept |
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
| `eventType` | `TaskEventType` | `CREATE` \| `MOVE` \| `RESIZE` \| `KEEP` \| `COMPLETE` \| `ABANDON`. `KEEP` = completed in the suggested slot (positive signal). |
| `oldSnapshot` / `newSnapshot` | Json | `{ scheduledStartTime, durationMinutes, tags }` (tag names at event time); MOVE/RESIZE also carry `suggestedStartTime` (the overridden EDF slot). `oldSnapshot` null on CREATE/KEEP. |
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

> **Tasks are one-off, and every task is flexible.** A `POST /tasks` always creates
> exactly one `Task` row, always EDF-placed (no more "fixed" tasks — that isn't the point
> of a smart scheduler). The only way a task stops moving is `manuallyMoved` (set when the
> user drags/resizes it, or accepts an overflow-recovery slot). There is no recurrence: no
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
| POST | `/users/me/onboarding` | finish onboarding (sets schedule + optional role archetype + optional `durationAdjustmentMode`) |
| GET | `/users/me/preference-matrix` | the current user's flat 672-int signed preference matrix for the Insights heatmap (`PreferenceMatrixResponse`; cold-start → all-zero). Read-only |

### Tasks (`/tasks`)
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/tasks` | create a single task — always flexible, always EDF-placed (`durationMinutes` is a plain required field; there is no more `fixed`/`startTime`/`endTime`). Accepts an optional `view` (`day`/`week`/`month`) that only drives the overflow-recovery granularity, and optional `viewStart`/`viewEnd` (ISO-8601 UTC bounds of the active calendar window): these scope the **view-scoped cascade** (see below) and, when the auto-placed task fell **outside** that window, populate an `overflow` block. `overflow` is populated when the task is unplaced, **or** when it is placed but outside `[viewStart, viewEnd)`. |
| GET | `/tasks?view=&date=&status=` | list within the view window (+ unplaced conflicts) |
| GET | `/tasks/suggestions?q=&limit=` | title-autocomplete: the user's existing tasks, **newest first** and **deduped by title** (case-insensitive), optionally filtered by the `q` substring. `limit` 1–50, default 10. Returns `TaskSuggestionsResponse` (`{ suggestions: Task[] }`). Read-only; never reschedules. Declared **before** `/tasks/:id` so it isn't matched as an id |
| GET | `/tasks/:id` | task detail + last events |
| PATCH | `/tasks/:id` | metadata only (title/note/deadline/tags), saved immediately at the task's current slot — **does NOT reschedule**. A `deadline` change sets `UpdateTaskResponse.deadlineChanged: true` so the frontend can prompt for a confirm-before-reschedule (see `reschedule-cascade` below) instead of auto-cascading. A `tags` change runs the same Phase-2 duration corrector `POST /tasks` uses and returns it as `schedulingMeta` (never auto-applied) |
| POST | `/tasks/:id/reschedule-cascade` | explicitly run the **view-scoped cascade** for one task — the deadline-edit confirm flow, and the tag-driven duration-adjustment accept flow (optionally supply `durationMinutes` to apply an accepted correction before the cascade runs). Body: `RescheduleCascadeInput` (`viewStart?`, `viewEnd?`, `durationMinutes?`). Returns a `RescheduleResponse` |
| PATCH | `/tasks/:id/reschedule` | manual drag → `pin`, records MOVE + signed preference telemetry |
| PATCH | `/tasks/:id/resize` | edge-resize, snaps to 15-min grid, recomputes conflicts |
| PATCH | `/tasks/:id/resolve-overflow` | accept a create-overflow recovery option (`{ choice: "outsideHours"\|"nextAvailable", view? }`); re-derives the slot server-side, pins the task via `manuallyMoved` (the only anchor mechanism now that fixed tasks are gone), records MOVE. Returns a `RescheduleResponse` |
| PATCH | `/tasks/:id/complete?viewStart=&viewEnd=` | mark DONE, records COMPLETE; re-settles the remaining set via the view-scoped cascade (optional query bounds) |
| DELETE | `/tasks/:id?viewStart=&viewEnd=` | delete the task; re-settles the remaining set via the view-scoped cascade (optional query bounds) |

> **View-scoped cascade (the blast-radius fix).** `cascadeReschedule` no longer re-derives
> placement for every PENDING task on every create/complete/delete — that "big hammer" was
> the direct cause of an unrelated already-placed task silently moving/conflicting as a side
> effect of scheduling something else. Now, when the caller supplies the active calendar
> view's `viewStart`/`viewEnd`, only **non-manual tasks currently placed inside
> `[viewStart, viewEnd)`** — plus the task the caller is specifically trying to place (the
> newly-created task, or the target of an explicit `reschedule-cascade`) — are eligible to
> move; everything else (out-of-view tasks, and every `manuallyMoved` task regardless of
> range) is frozen as occupied space. `POST /tasks`, `PATCH /tasks/:id/complete`,
> `DELETE /tasks/:id`, and `POST /tasks/:id/reschedule-cascade` all apply this scoping.
> Omitting the bounds falls back to the unscoped (full) cascade — the one remaining case is
> the background reschedule `PUT /users/me/preferences` triggers, which has no "current
> view" to bound to. There is also no more per-task creation-day anchor or period ceiling
> (`schedulingAnchor`/`view` columns, `schedulingDeadline`) — a no-deadline task is simply
> packed from `now` forward with no artificial per-task ceiling, which also fixes a task
> showing "out of slot" even when the day is completely empty.
>
> **Overflow recovery.** When `POST /tasks` returns an unplaced task the response also
> carries `overflow: { outsideHours, nextAvailable }`, computed relative to **today** (the
> calendar period containing `now`), not to any stored per-task context. `outsideHours` is
> the earliest off-(working)-hours slot **inside** today's period `[periodStart, periodEnd)`,
> at/after `now`, respecting occupied intervals **and** any deadline (null if no off-hours
> slot fits — e.g. the period has ended). `nextAvailable` is the earliest work-hours slot in
> the **next** period (next day/week/month), **ignoring** the deadline. The user picks one and
> the frontend calls `PATCH /tasks/:id/resolve-overflow`, which recomputes the slot
> server-side (the client time is never trusted) and pins the task via `manuallyMoved` so the
> next cascade can't bounce it back to unplaced.

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

- **`feasibleSlots(prefs, durationMinutes, deadline, occupied, now, earliest?)`** — ALL
  feasible 15-min-grid work-hours start instants (ascending) for the task: the re-ranker seam
  the heuristic roadmap re-ranks over. The deadline is a hard cutoff (the scan stops at the
  first candidate that would end past it).
- **`findSlot(...)`** — earliest contiguous work-hours slot of the required length that
  starts at/after `earliest`/`now` and ends before `deadline`; defined as
  `feasibleSlots(...)[0] ?? null`, so packer and re-ranker share one feasibility definition.
- **`reranker.ts`** — `SlotReRanker.score(task, candidates)` re-orders the feasible set by
  preference; Phase 1 ships `identityReRanker` (returns it unchanged). `scheduleAll` routes
  every placement through it, so Phase 2's signed matrix plugs in here without touching
  feasibility.
- **`compareEdf(a, b)`** — the ordering: deadline ascending (nulls last), then `createdAt`.
  There is no more per-task period ceiling — a no-deadline task simply sorts last (rank
  `+Infinity`) and is packed from `now` with no artificial upper bound (up to `MAX_SCAN_DAYS`).
- **`scheduleAll(prefs, tasks, now, reRanker?, scope?)`** — deterministic re-EDF.
  `manuallyMoved` tasks stay put; every other movable task is EDF-packed around them and
  everything else occupied. The optional `ScheduleScope` (`{ viewStart, viewEnd,
  includeTaskId? }`) bounds the blast radius: with a scope, only non-manual tasks currently
  placed inside `[viewStart, viewEnd)` — plus `includeTaskId` regardless of its own placement
  — are movable; everything else (out-of-range tasks, every `manuallyMoved` task) is frozen as
  occupied space instead of being re-derived. Omitting `scope` is the unscoped (full) re-pack
  — used for preference changes, which have no "current view" to bound to.
- **`periodRange(anchor, view, tz, work?)` / `endOfPeriod(anchor, view, tz, work?)`**
  ([`horizon.ts`](src/scheduler/horizon.ts)) — pure UTC bounds `[start, end)` of the
  day / ISO-week / month containing `anchor` in the user's tz. Reuses `weekStartStr`/
  `monthRange` so FE and BE agree on period edges. Used ONLY by the overflow-recovery helpers
  below (there is no more per-task period ceiling on ordinary placement). **Night-owl
  (wrapping) work windows:** when the optional `work` (`{ workStart, workEnd }`) describes a
  window that wraps past midnight (`workEnd <= workStart`, e.g. 22:00→06:00), the last work
  window that *starts* within the period ends the next morning at `workEnd`, so `end` is
  **extended** from the bare next-period 00:00 to `workEnd` on that following morning — this
  is also why `scheduleAll` can place a **single contiguous task crossing midnight** (e.g. a
  4h task at 22:00→02:00): `workWindowFor`'s wrap-aware window math applies regardless of any
  ceiling. A non-wrapping window (or omitting `work`) keeps the legacy 00:00 boundary
  byte-for-byte. The morning tail is not double-counted in capacity — `sumWorkMinutes` is
  start-day anchored and counts each window's minutes once.
- **`findSlotIgnoringWorkHours(durationMinutes, deadline, occupied, now, periodStart, periodEnd)`**
  ([`overflow.ts`](src/scheduler/overflow.ts)) — earliest 15-min-grid slot **inside**
  `[periodStart, periodEnd)` (today's period — see below), at/after `now`, ignoring the
  work-hours window/work days but still avoiding `occupied` and ending ≤ `deadline`; `null`
  when no off-hours slot fits the period. Backs the `outsideHours` recovery option.
- **`findNextAvailableSlot(prefs, durationMinutes, occupied, now, anchor, granularity)`**
  ([`overflow.ts`](src/scheduler/overflow.ts)) — earliest **work-hours** slot in the **next**
  period after `anchor`'s period (`day` → next working day, `week` → next week, `month` →
  next month), **ignoring** the deadline; reuses `findSlot`'s window/grid math via the next
  period boundary (`periodRange(anchor, …, work).end`) as its floor. For a wrapping window the
  period's extended (post-midnight) end is used, so the morning tail is offered via
  `outsideHours` rather than re-offered here as "next available". Backs the `nextAvailable`
  recovery option. Both helpers stay pure (`now` + explicit period inputs, no I/O);
  `SchedulerService.computeOverflowOptions` / `applyOverflowOption` are the persistence
  wrappers — `anchor` is simply the start-of-day of `now` (there is no more per-task stored
  creation context to prefer; every recovery option is relative to "today").
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

`SchedulerService` wraps these to persist placements, write `TaskEvent`s, and apply signed
updates to the `preferenceMatrix` (move-away −1, move-toward/keep +1). A `scoreSlot()` seam is reserved here for the **Phase 3 bandit** to plug
into (see [`services/bandit/README.md`](../services/bandit/README.md) and
[`docs/heuristic.md`](../docs/heuristic.md)).

### Phase 2 — personalized scheduling (live)

The matrix/bias/decay are computed in the **service** and passed into the **pure** core
(invariant #2). The pure pieces (`reranker.ts`, `duration-bias.ts`, `matrix-decay.ts`) take
inputs as params and do no I/O; the service is the only thing that reads Prisma.

- **Placement re-ranker** (`reranker.ts` → `preferenceMatrixReRanker(matrix, tz)`): a pure
  permutation that re-orders EDF's feasible slots by descending signed-cell score.
  `SchedulerService.cascadeReschedule` builds it from `user.preferenceMatrix` and threads it
  through `scheduleAll`. A cold-start / wrong-length matrix degenerates to identity, so a
  fresh user is byte-for-byte Phase-1.
- **Duration corrector** (`duration-bias.ts` → `blendBias` / `correctDuration`):
  `SchedulerService.computeDurationCorrection` aggregates per-tag `{ n, b }` from `TaskEvent`
  telemetry (rolling `actual ÷ estimated`), blends it sample-weighted, and rounds the
  corrected duration **up** to the 15-min grid. `TasksService.create` applies it as
  preprocessing **before** EDF — gated by `user.durationAdjustmentMode`: `never` feeds the
  uncorrected estimate to EDF but **still learns** the bias. The real `biasApplied`,
  `estimatedDuration`, `durationAdjustmentMode`, and `durationReason` are surfaced on the
  create response's `schedulingMeta`.
- **Rationale** (`rationale.ts` → `buildRationale`): `schedule`/`reschedule`/`resize`/
  `resolve-overflow` responses carry an optional `SchedulingRationale` describing the
  preferred work window + top cells that drove the placement (null when the slot wasn't
  preference-favoured).
- **Matrix-decay cron** (`matrix-decay.service.ts`, `@Cron` daily): the I/O wrapper loads each
  user's `preferenceMatrix` + `preferenceMatrixDecayedAt`, calls the pure `decayMatrix`
  (`cell *= 2^(−Δdays / MATRIX_HALF_LIFE_DAYS)`, 21-day half-life), and writes back.

> When you change any pure scheduler function, update its `*.spec.ts` in the same change
> (`edf.spec.ts`, `horizon.spec.ts`) and run `pnpm --filter backend test`.

## Persona simulator (`src/simulation/`)

A **closed-loop driver** that produces synthetic telemetry for the personalization roadmap
(`docs/simulation-strategy.md`, `docs/seed-implementation.md`). It seeds a population of
synthetic users with hidden "true" preferences, then drives the **real** `TasksService` /
`SchedulerService` / `AbandonedTasksService` over a ~1-year virtual timeline — so every
`TaskEvent`, `suggestedStartTime` snapshot, and signed `preferenceMatrix` update is produced
through the production path, never hand-written.

- **Determinism:** all randomness flows through one seeded `mulberry32` PRNG (`rng.ts`) — no
  `Math.random()`. `rng.ts`, `clock.ts`, `personas/*`, and `behavior/*` are **pure**; only
  `runner.ts` touches Prisma/services (same purity rule as the scheduler core).
- **Virtual `now`:** the mutation methods (`create`, `complete`, `reschedule`, `resize`,
  `resolveOverflow`, and `SchedulerService.pin`/`resize`/`applyOverflowOption`/`recordKeep`)
  take an optional `now: Date = new Date()` and stamp it onto `cascadeReschedule` + every
  `TaskEvent.occurredAt`. Controllers call with no `now`, so **production is unchanged**; the
  simulator passes the simulated instant so events spread across the year.
- **Anti-circularity:** the ground-truth archetype label lives **only** in the in-memory
  `Persona` (and the eval labels output), never in a `User` column a learner reads. The
  generator embeds drivers no Phase-2 matrix can represent — tag×time interactions (`P_tag`),
  drift, fatigue, a noise floor — so recovery is a real finding, not a tautology.
- **Re-ranker seam:** only `--reranker=identity` (the Phase-1 baseline) is wired today; a
  future re-ranker drops into the same `SlotReRanker` seam.
- **Compiled, not `ts-node`:** the repo uses baseUrl `src/*` imports that only `nest build`
  rewrites, so `sim:run`/`sim:eval` build to `dist/` and run the compiled output (matching
  production module resolution). `sim:run` rebuilds automatically; rerun `sim:build` before
  `sim:eval` if you changed simulator code since the last `sim:run`.

```bash
# Dedicated DB (never dev/prod) — copy .env.dev → .env.sim, point DATABASE_URL at zenflow_sim.
# Pass CLI flags after `--` so pnpm forwards them to the script.
pnpm --filter backend sim:reset                                       # drop + recreate sim schema (db push --force-reset)
pnpm --filter backend sim:run -- --seed=1 --days=30 --personas=5      # quick run (needs the DB)
pnpm --filter backend sim:run -- --seed=1 --start=2025-01-06 --days=365   # full year
pnpm --filter backend sim:eval                                        # MAR + supporting metrics + IPS/SNIPS
```

`sim:run` needs a reachable `zenflow_sim` Postgres; the pure pieces (`rng`, `reaction.model`,
`metrics`) are covered by `*.spec.ts` and run without a DB. Use a span of **≥~30 days** for
smoke runs — each persona draws vacation/idle windows sized for the span, so a handful of days
can legitimately produce zero events. Reusing the same `--seed` reuses persona emails
(`sim-<archetype>-<n>@zenflow.sim`); run `sim:reset` between same-seed runs to avoid the unique
constraint. `sim:reset` is destructive; if invoked by an AI agent Prisma will block it pending
explicit user consent.

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
