# Zenflow API (backend)

NestJS service that owns persistence, auth, file storage, and task CRUD. Part of the
[Zenflow monorepo](../README.md) — start there for the big picture and quick start.

---

## Tech stack

| Concern              | Choice                                                                                                                            |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Framework            | NestJS 11 (Express platform)                                                                                                      |
| Language             | TypeScript 5.7 (ES2023, `nodenext`)                                                                                               |
| ORM / DB             | Prisma 6 + PostgreSQL                                                                                                             |
| Sessions &amp; cache | Redis (`connect-redis` sessions, `@nestjs/cache-manager` + keyv)                                                                  |
| Auth                 | Passport `local` strategy used for **email OTP** (no passwords)                                                                   |
| Scheduling/time      | `luxon`, `date-fns` / `date-fns-tz`                                                                                               |
| Validation           | `class-validator` + `class-transformer` (global `ValidationPipe`)                                                                 |
| Mail                 | `@nestjs-modules/mailer` + nodemailer + Handlebars templates                                                                      |
| Rate limiting        | [LimitKit](https://github.com/alphatrann/limitkit) (`@limitkit/core` + `nest` + `redis` + `memory`), own dedicated Redis instance |
| API docs             | `@nestjs/swagger` (served at `/api`)                                                                                              |
| Tests                | Jest (unit `*.spec.ts`, e2e via `test/jest-e2e.json`)                                                                             |
| Shared types         | `@zenflow/shared` (`workspace:*`) — the FE/BE contract                                                                            |

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
│   ├── users/                 # profile (no onboarding/preferences endpoints — see below)
│   │   └── decorators/        # @CurrentUser()
│   ├── sessions/               # session CRUD; create/deadline-edit trigger the implicit
│   │   │                       #   day reschedule below
│   │   └── ...
│   ├── scheduler/              # the heuristic implicit-day-reschedule engine (see below)
│   │   ├── heuristic.ts         # PURE — sortEDF() + bestFreeSlot() + optimize(), no I/O
│   │   ├── heuristic.spec.ts
│   │   ├── utils/               # PURE algorithm scaffolding — no I/O, fully unit-tested
│   │   │   ├── slot.ts          # 15-min slot grid math, isoWeekday, overlap check
│   │   │   ├── horizon.ts       # calendar math (period ceilings, calendar minutes)
│   │   │   └── matrix-decay.ts  # pure exponential preference-matrix decay
│   │   ├── day-reschedule.service.ts  # the only I/O layer: loads one day's candidates,
│   │   │                              #   calls the pure core, writes SessionEvents in one
│   │   │                              #   $transaction. No controller — SessionsService
│   │   │                              #   calls it directly (see below)
│   │   ├── matrix-decay.service.ts    # @Cron: daily preference-matrix decay
│   │   └── abandoned-sessions.service.ts # @Cron: hourly overdue → ABANDONED sweep
│   ├── files/                 # multipart upload/download to local disk
│   ├── mail/                  # login email + Handlebars templates
│   ├── prisma/                # PrismaService + Postgres error-code map
│   └── common/                # constants, utils, validators, dto, types
│       ├── redis/             # two connected `redis` clients: REDIS_CLIENT (session/OTP)
│       │                      #   and RATE_LIMIT_REDIS_CLIENT (LimitKit counters)
│       └── rate-limit/        # LimitKit wiring — see "Rate limiting" below
├── compose.{dev,staging,prod,test}.yml
├── Caddyfile.{staging,prod}
├── Dockerfile
└── .env.{dev,staging,prod,test} + docker.{dev,staging,prod,test}.env
```

**Key layering rule:** `scheduler/heuristic.ts` and `scheduler/utils/` are **pure and
deterministic** (no database, no clock, no randomness — `now` is always passed in).
`DayRescheduleService` is the only thing that touches Prisma and records telemetry. Keep
that split: it's what makes the engine unit-testable and what a future personalization
pass will plug into.

## Database schema

Defined in [`prisma/schema.prisma`](prisma/schema.prisma). Five core models below
(`User`, `Session`, `SessionEvent`, `Tag`, `File`), plus schema scaffolding for the DLU-pivot
work — `UserEncryptionKey`, `UserDevice`, `SessionSeries`, `SlotProposal`, `Integration`,
`Notification`, `CrawlJob`/`CrawlJobItem`, `CrawledUrl`, `PortalAPIJob`/`PortalAPIJobItem`.
`UserEncryptionKey` and `Integration` are live (see _Integrations_); the rest are added
ahead of their per-issue implementation and **not yet wired to any endpoint, DTO, or
service**. Briefly:

- `UserEncryptionKey` — per-`(user, provider)` data-encryption key, stored wrapped
  (`key`/`iv`/`authTag`) under that provider's env master key. `version` and
  `masterKeyVersion` rotate independently. Created on first connect.
- `UserDevice` — one row per Expo push registration (`platform`, `pushToken`), so a user
  can have multiple devices.
- `SessionSeries` — links N session-instance `Session` rows of one "study sessions" goal;
  deleting the series cascades to its sessions. `Session` gained `type`
  (`MANUAL`/`ASSIGNMENT`/`EXAM`/`LECTURE`), `source` (`USER`/`LMS`/`PORTAL`), and
  `seriesId`/`sessionIndex`/`sessionTotal` to support this.
- `SlotProposal` — one row per create/reschedule event, holding both the heuristic's and
  LinUCB's proposed placement plus which one (`pickedModel`) actually won.
- `Integration` — LMS/portal credentials, one row per `(userId, provider)`. The
  `{ username, password }` blob is AES-256-GCM–encrypted under the user's
  `UserEncryptionKey` (`encryptedCredentials`/`iv`/`authTag`), which is itself wrapped
  under the env master key — two layers, no plaintext credential column.
- `Notification` — inbox row (assignment/exam detected on LMS, or a timetable change on
  the portal) a student can turn into a `Session`; `actionTakenAt` guards against double
  creation.
- `CrawlJob`/`CrawlJobItem` and `PortalAPIJob`/`PortalAPIJobItem` — per-run job tracking
  (shared `JobStatus` enum) for the LMS crawler and the portal API poller, each scoped to
  an `Integration`.
- `CrawledUrl` — global (cross-user) URL dedupe table so two students' crawls of the same
  course activity don't double-detect.

### `User`

| Field                       | Type       | Notes                                                                                                                                                                                                                                                 |
| --------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                        | uuid       | PK                                                                                                                                                                                                                                                    |
| `name`, `email`             | string     | `email` unique                                                                                                                                                                                                                                        |
| `timezone`                  | string     | IANA, default `"UTC"`                                                                                                                                                                                                                                 |
| `lang`                      | `Language` | `VI_VN` \| `EN_US`, default `EN_US`. Not yet read by any endpoint.                                                                                                                                                                                    |
| `preferenceMatrix`          | int[]      | flat **672** ints (7 days × 96 fifteen-minute slots, slot-grid-aligned). **Signed** Phase-1 telemetry: a move-toward/keep increments a cell (+1), a move-away decrements it (−1), empty = 0 (neutral). **Not yet read** by the engine. Seeded lazily. |
| `preferenceMatrixDecayedAt` | DateTime?  | When the daily decay cron last decayed `preferenceMatrix`; null until the first pass                                                                                                                                                                  |
| `onboardingComplete`        | bool       | schema default `false`, but `UsersService.create()` always writes `true` — there's no onboarding flow left to gate on (see "Users" below). The column itself is unused dead weight pending a follow-up migration to drop it.                          |

`workStart`/`workEnd`/`workDays` (a per-user working-hours window/working-days set) were
**dropped with no replacement**. The scheduler now places tasks across the full
24h/`DAILY_HORIZON` (1440 min) grid, every calendar day — see "The heuristic scheduler (Optimize)" below.

### `Session`

| Field                           | Type            | Notes                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                            | uuid            | PK                                                                                                                                                                                                                                                                                                                                                      |
| `title`, `note`                 | string          | `note` is rich text (TipTap)                                                                                                                                                                                                                                                                                                                            |
| `durationMinutes`               | int             | **always a positive multiple of 15**                                                                                                                                                                                                                                                                                                                    |
| `deadline`                      | DateTime?       | EDF ordering key (nulls last)                                                                                                                                                                                                                                                                                                                           |
| `tags`                          | `Tag[]`         | implicit many-to-many with `Tag` (per-user labels)                                                                                                                                                                                                                                                                                                      |
| `manuallyMoved`                 | bool            | true → the user dragged/resized this task. **Purely informational** everywhere automatic (drives the "Manually placed" badge/telemetry) — no automatic path ever freezes/protects a task because of it. The ONE place it gates real behavior is Optimize's `"retainManual"` mode (explicit user opt-in); see "The heuristic scheduler (Optimize)" below |
| `startTime`                     | int             | minutes from midnight of the last manual placement; informational only, not consulted by the scheduler                                                                                                                                                                                                                                                  |
| `status`                        | `SessionStatus` | `PENDING` \| `DONE` \| `ABANDONED`                                                                                                                                                                                                                                                                                                                      |
| `type`                          | `SessionType`   | `MANUAL` \| `ASSIGNMENT` \| `EXAM` \| `LECTURE`, default `MANUAL`. Not yet read by any endpoint.                                                                                                                                                                                                                                                        |
| `source`                        | `SessionSource` | `USER` \| `LMS` \| `PORTAL`, default `USER`. Not yet read by any endpoint.                                                                                                                                                                                                                                                                              |
| `conflict`                      | bool            | true when the task overlaps another task's interval, OR has no valid placement at all (`scheduledStartTime` null). An overlap is now a normal, accepted state — a direct drag/resize can knowingly create one rather than auto-relocating either task; see "The heuristic scheduler (Optimize)" below                                                   |
| `scheduledStartTime`            | DateTime?       | placement assigned by the EDF engine                                                                                                                                                                                                                                                                                                                    |
| `userId`                        | uuid            | FK → `User`, `onDelete: Cascade`                                                                                                                                                                                                                                                                                                                        |
| `seriesId`                      | uuid?           | FK → `SessionSeries`, `onDelete: Cascade` — links session instances of a "study sessions" goal. Not yet written by any endpoint.                                                                                                                                                                                                                        |
| `sessionIndex` / `sessionTotal` | int?            | denormalized convenience fields alongside `seriesId` for cheap per-row rendering. Not yet written by any endpoint.                                                                                                                                                                                                                                      |

Indexes: `[userId, deadline]`, `[userId, status]`, `[userId, scheduledStartTime]`,
`[userId, seriesId, createdAt asc]`.

### `SessionEvent` (append-only audit trail — the ML fuel)

| Field                         | Type               | Notes                                                                                                                                                                                                                                                                     |
| ----------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------- | ------ | ---------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                          | BigInt             | autoincrement (serialized as decimal string over the wire)                                                                                                                                                                                                                |
| `eventType`                   | `SessionEventType` | `CREATE`                                                                                                                                                                                                                                                                  | `MOVE` | `RESIZE` | `KEEP` | `COMPLETE` | `ABANDON` | `RESCHEDULED`. `KEEP` = completed in the suggested slot (positive signal); `RESCHEDULED` = auto-repositioned as collateral in someone else's cascade (not a user drag). |
| `oldSnapshot` / `newSnapshot` | Json               | `{ scheduledStartTime, durationMinutes, tags }` (tag names at event time); MOVE/RESIZE also carry `suggestedStartTime` (the overridden EDF slot); RESCHEDULED carries `propensity` when the softmax re-ranker actually chose the slot. `oldSnapshot` null on CREATE/KEEP. |
| `rewardScore`                 | float              | Phase-3 reward signal (default 1.0)                                                                                                                                                                                                                                       |
| `occurredAt`                  | DateTime           | indexed desc per user                                                                                                                                                                                                                                                     |
| `sessionId` / `userId`        | uuid               | FKs, cascade delete (`userId` denormalized for range queries)                                                                                                                                                                                                             |

> There is no `batchId` field — the old manual Optimize action (and its undo) that used it
> was removed. Every RESCHEDULED event the implicit day-reschedule writes stands alone.

### `Tag`

Per-user label in an implicit many-to-many with `Session`.

| Field       | Type     | Notes                                        |
| ----------- | -------- | -------------------------------------------- |
| `id`        | uuid     | PK                                           |
| `name`      | string   | unique per user (`@@unique([userId, name])`) |
| `userId`    | uuid     | FK → `User`, `onDelete: Cascade`             |
| `createdAt` | DateTime |                                              |

On task create/update the backend resolves an incoming array of tag **names**:
unknown names are upserted (per user) and all are connected to the occurrence(s),
atomically inside the task transaction. The wire format keeps `Session.tags` as a
`string[]` of names — the `Tag` table is a backend detail.

### `File`

`id`, `originalName`, `filename`, `path`, `mimetype`, `size`, `userId` (cascade).

> **Sessions are one-off, and every task is flexible.** A `POST /tasks` always creates
> exactly one `Session` row, placed via the narrow single-task tiered placer (no more "fixed"
> tasks — that isn't the point of a smart scheduler). There is no recurrence: no
> `rrule`, no `seriesId`, no `scope`. True recurrence may be reintroduced later as a
> deliberate feature on top of this simplified scheduler.

## API endpoints

Global prefix `**/api/v1**`. All routes except `POST /auth/otp/*` require
`CookieAuthGuard` (a valid Redis session cookie). Success responses use the
`@zenflow/shared` envelope `{ success: true, message?, data }`; errors use
`{ success: false, message, statusCode?, field? }`.

### Auth (`/auth`)

| Method | Path                | Purpose                                                                                                               |
| ------ | ------------------- | --------------------------------------------------------------------------------------------------------------------- |
| POST   | `/auth/otp/request` | email a 6-digit OTP (no auth guard; rate-limited, see below)                                                          |
| POST   | `/auth/otp/verify`  | verify OTP, create user if new, start session. Reads `x-timezone` header. (`LocalAuthGuard`; rate-limited, see below) |
| GET    | `/auth/me`          | current user                                                                                                          |
| POST   | `/auth/logout`      | destroy session                                                                                                       |

### Users (`/users`)

| Method | Path                          | Purpose                                                                                                                                          |
| ------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/users/me`                   | profile                                                                                                                                          |
| PATCH  | `/users/update/basic-info`    | update name/email                                                                                                                                |
| GET    | `/users/me/preference-matrix` | the current user's flat 672-int signed preference matrix for the Insights heatmap (`PreferenceMatrixResponse`; cold-start → all-zero). Read-only |

There is no onboarding endpoint and no preferences-update endpoint. Onboarding was removed
entirely (no flow, no `onboardingComplete` gate — every new user is created with
`onboardingComplete: true`). `timezone` is captured once at OTP signup (`x-timezone` header
on `POST /auth/otp/verify` → `AuthService.createUserIfNotExists` → `UsersService.create()`)
and is otherwise fixed — there is no later edit path.

### Sessions (`/tasks`)

| Method | Path                              | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------ | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/tasks`                          | create a single task, always placed via the narrow single-task tiered placer (`SchedulerService.placeNewSession` → `place.ts`'s `placeSession`, Tier1→2→3). Only ever picks an already-free slot — **never** displaces another task. `displaced` is always `[]`. Only comes back unplaced (`conflict: true`) in the rare genuinely-saturated-calendar case                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| GET    | `/tasks?view=&date=&status=`      | list within the view window (+ unplaced conflicts). DB-level filter: `scheduledStartTime IS NULL OR BETWEEN displayStart AND displayEnd` — never fetches the user's whole task history                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| GET    | `/tasks/suggestions?q=&limit=`    | title-autocomplete: the user's existing tasks, **newest first** and **deduped by title** (case-insensitive), optionally filtered by the `q` substring. `limit` 1–50, default 10. Returns `SessionSuggestionsResponse` (`{ suggestions: Session[] }`). Read-only; never reschedules. Declared **before** `/tasks/:id` so it isn't matched as an id                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| GET    | `/tasks/:id`                      | task detail + last events                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| PATCH  | `/tasks/:id`                      | metadata only (title/note/deadline/tags) saved immediately. **Never auto-searches.** `tags` is only actually rewritten when the requested set differs (order-insensitive) from the task's current tags — not merely present in the body, since both clients resend the full form on every save. If the new deadline leaves the task's own UNCHANGED slot no longer valid, `UpdateSessionResponse.rationale` explains it's now broken and the frontend/mobile show an Accept/Decline toast — this does **not** set `conflict: true` (that's an "overdue own-slot-vs-own-deadline" case, not a double-booking; `conflict` is reserved for genuine pairwise overlap, see `markConflicts` below). `displaced`/`batchId` are always empty/null; Accept calls the separate resolve endpoint below |
| POST   | `/tasks/:id/reschedule/resolve`   | Edit-accept: re-places a task `update()` just reported as broken, via the same Tier1→2→3 search `placeNewSession` uses (`SchedulerService.resolveInvalidPlacement`) — excludes the task's own stale slot from occupied space. No body. A no-op (task returned as-is) when the task isn't currently flagged conflicting AND its own slot still fits its own deadline (recomputed server-side, since `update()` doesn't persist a flag for this case). Writes a `RESCHEDULED` event + fresh `batchId` (undoable) when it does move something. Returns `RescheduleResponse`                                                                                                                                                                                                                    |
| PATCH  | `/tasks/:id/reschedule`           | manual drag: writes the requested interval **unconditionally** (`SchedulerService.applyDirectPlacement`) — no search, no eviction — and pins `manuallyMoved: true` (informational). If the dropped slot now overlaps another task, BOTH are flagged `conflict: true` (one bounded, indexed-range recheck — `markConflicts`) and `rationale` names the overlap; neither is auto-relocated. `displaced` is always `[]`. Returns `RescheduleResponse`                                                                                                                                                                                                                                                                                                                                          |
| PATCH  | `/tasks/:id/resize`               | edge-resize, snaps to 15-min grid — same direct-write + bounded conflict recheck `reschedule` uses, over the task's own new span                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| POST   | `/tasks/reschedule/undo/:batchId` | undo one batch (from `resolve`/Optimize-apply's `batchId`): reverts every task it moved back to its prior slot/duration, restored from each tagged `RESCHEDULED` `SessionEvent`'s `oldSnapshot`. Pre-flight "touched since" check: if a batched task was acted on again since, responds `{ requiresConfirmation: true, touchedSessionIds }` (writes nothing) instead — resubmit with body `{ strategy: "all" \| "excludeTouched" }`. 404 when `batchId` matches no event for this user. Returns `UndoBatchResponse`                                                                                                                                                                                                                                                                         |
| PATCH  | `/tasks/:id/complete`             | mark DONE, records COMPLETE, then frees the slot (`SchedulerService.freeSlot`) — a bounded conflict-clear on a neighbor that was ONLY conflicting with this task. Nothing else ever moves                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| DELETE | `/tasks/:id`                      | delete the task, then free the slot it leaves behind (`SchedulerService.freeSlot`) — same bounded conflict-clear as `complete`. No reoptimize, no separate confirm step. Returns `RemoveSessionResponse` (`{ displaced: [], batchId? }` — always empty; kept for wire shape parity)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| POST   | `/tasks/optimize/preview`         | the one explicit, opt-in, multi-task action's dry run: `SchedulerService.optimizeWindow(..., { dryRun: true })` returns a **COUNT ONLY** (`OptimizePreviewResponse`) of how many tasks in `[windowStart, windowEnd]` would move under `mode` (`"full"` \| `"retainManual"` \| `"balanced"`) — never a per-task diff, nothing written. `windowEnd - windowStart` is capped server-side by `MAX_SCAN_DAYS` regardless of the client UI's own (tighter) cap                                                                                                                                                                                                                                                                                                                                    |
| POST   | `/tasks/optimize/apply`           | recomputes the window server-side (never trusts the preview's count as stale) and writes every moved task in one batch, undoable via the undo endpoint above. Returns `OptimizeApplyResponse` (`{ count, batchId, fixedCount?, unchangedCount? }` — the `fixedCount`/`unchangedCount` pair is `"retainManual"`-only)                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

### Tags (`/tags`)

| Method | Path    | Purpose                                                                                 |
| ------ | ------- | --------------------------------------------------------------------------------------- |
| GET    | `/tags` | list the current user's tags (`{ tags: { id, name }[] }`, name-sorted) for the combobox |

### Files (`/files`)

`POST /files/upload` (multipart, ≤100 MB × 5), `POST /files/remove`,
`GET /files/metadata/:id`, `GET /files/:id` (download stream).

### Integrations (`/integrations`)

Stores a student's DLU LMS / student-portal login for the ingestion watcher.
`CookieAuthGuard` + `@CurrentUser()`, own rows only. Credentials are never returned —
only connection status. Types in `@zenflow/shared` (`ConnectIntegrationInput`,
`IntegrationStatus`, `IntegrationStatusListResponse`).

| Method | Path                      | Purpose                                                                                                                                                                                                             |
| ------ | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/integrations`           | Connect a provider. Body `{ provider: "LMS" \| "PORTAL", username, password }`. Probes a live login first (`400` if rejected, `503` if DLU is unreachable, no write either way), then encrypts and upserts the row. |
| GET    | `/integrations`           | `{ integrations: [{ provider, connected, lastVerifiedAt }] }` — one entry per provider.                                                                                                                             |
| DELETE | `/integrations/:provider` | Disconnect. Idempotent; keeps the `UserEncryptionKey`.                                                                                                                                                              |

`DluAuthService` only does a pass/fail probe; scraping belongs to the ingestion service.

Full live schema: **Swagger UI at `<API_URL>/api`**.

## Rate limiting

The OTP-sending auth endpoints — `POST /auth/otp/request` (emails a code on every call)
and `POST /auth/otp/verify` (guesses against a 6-digit code) — are rate-limited with
[LimitKit](https://github.com/alphatrann/limitkit) (`@limitkit/core` + `@limitkit/nest` +
`@limitkit/redis` + `@limitkit/memory`, all published on the public npm registry) to stop
email-bombing, account enumeration, and OTP brute-forcing.

- **Where it's wired:** [`src/common/rate-limit/`](src/common/rate-limit).
  `RateLimitModule` registers `@limitkit/nest`'s `LimitModule` with a **global** rule set
  that's a no-op in practice (a single, extremely generous placeholder rule — `LimitKit`'s
  `RateLimiter` throws if given zero rules, and `LimitGuard` runs as `APP_GUARD` on every
  request regardless). Real limiting is opt-in per route via the `@RateLimit()` decorator —
  applied only to `AuthController`'s `otp/request` and `otp/verify` handlers
  (`rate-limit.rules.ts`) — so the rest of the API is unaffected.
- **Rules:** each guarded route layers a **per-IP** sliding window (the documented LimitKit
  login example, `slidingWindow({ window, limit })`) with a **per-email** sliding window
  (lower-cased, keyed off the request body), so an attacker spraying one victim's inbox from
  many IPs is still capped. `otp/verify`'s limits are intentionally looser than
  `otp/request`'s so a user retyping a mistyped code isn't blocked.
- **Store:** `@limitkit/redis`'s `RedisStore`, backed by its own dedicated, already-connected
  Redis client (`src/common/redis/` — `RATE_LIMIT_REDIS_CLIENT`, connected to
  `RATE_LIMIT_CACHE_URL`) outside tests; `@limitkit/memory`'s `InMemoryStore` when
  `NODE_ENV === "test"`, so tests never depend on a running Redis for rate-limit state.
  This is a **separate physical Redis instance** from the one backing sessions/OTP codes
  (`REDIS_CLIENT` / `CACHE_URL`) — rate-limit counters are high-churn, short-TTL keys, and
  isolating them means that traffic can't evict or contend with session/OTP data (and vice
  versa). See `compose.{dev,staging,prod}.yml`'s `redis-ratelimit` service.
- **Rejection contract:** `LimitGuard` throws `TooManyRequestsException` (HTTP 429) with a
  plain-string body; `TooManyRequestsFilter` (registered as a global `APP_FILTER` inside
  `RateLimitModule`) re-shapes that into this app's `{ success: false, message }` envelope.
  The guard's `RateLimit-Limit` / `RateLimit-Remaining` / `Reset-After` / `Retry-After`
  headers (RFC 9331) pass through untouched.
- **Env vars** (validated in the `@hapi/joi` boot schema in `app.module.ts`, all optional
  with sensible defaults — see `.env.dev` / `.env.staging` / `.env.prod` / `.env.test` for
  example values):

  ```env
  OTP_REQUEST_IP_WINDOW_SEC=60      # default 60
  OTP_REQUEST_IP_LIMIT=5            # default 5   (the documented LimitKit login example)
  OTP_REQUEST_EMAIL_WINDOW_SEC=900  # default 900 (15 min)
  OTP_REQUEST_EMAIL_LIMIT=3         # default 3
  OTP_VERIFY_IP_WINDOW_SEC=60       # default 60
  OTP_VERIFY_IP_LIMIT=20            # default 20
  OTP_VERIFY_EMAIL_WINDOW_SEC=600   # default 600 (10 min)
  OTP_VERIFY_EMAIL_LIMIT=10         # default 10
  ```

- **Tests:** `test/rate-limit.e2e-spec.ts` proves N rapid requests to `POST /auth/otp/request`
  and `POST /auth/otp/verify` 429 once the per-IP limit is hit (in the `{ success: false,
message }` envelope) and that the endpoint is usable again once the sliding window rolls
  over — against `@limitkit/memory`, never real Redis, and without needing Postgres/SMTP (it
  boots a minimal `TestingModule` around the real `AuthController`/`AuthModule`/
  `RateLimitModule` wiring, with `PrismaService`/`UsersService`/`MailService` swapped for bare
  mocks, so it has no external dependencies). `src/common/rate-limit/*.spec.ts` unit-tests the
  rule key/policy resolution and the 429→envelope exception filter.

## Conventions

- **Naming:** plural feature folders/classes (`SessionsController`, `UsersService`,
  `SessionsModule`). DTOs end in `Dto`; guards in `Guard`; strategies in `Strategy`.
- **DTOs + validation:** every request body/query is a `class-validator` DTO. The global
  pipe runs `whitelist: true, forbidNonWhitelisted: true, transform: true` with implicit
  conversion — so unknown fields are rejected and query params coerce to their typed shape.
  Custom decorators: `@IsValidTimezone()`, plus `@CurrentUser()`. `Session.title` is capped at
  60 characters via `class-validator`'s built-in `@MaxLength(60)`.
- **Response shape:** controllers return `{ success: true, message, data }`; let NestJS
  `HttpException`s propagate (don't swallow). Prisma errors map via
  [`src/prisma/error-codes.ts`](src/prisma/error-codes.ts).
- **Shared types are the contract:** request/response shapes live in `@zenflow/shared`
  (`CreateSessionInput`, `SessionsListResponse`, `RescheduleResponse`, …). Change types there and
  `pnpm shared:build` before relying on them.
- **Module wiring:** a feature module imports `PrismaModule` when it needs the DB;
  `SchedulerModule` is imported by `SessionsModule`.

## Local development

**Prerequisites:** [Docker](https://docs.docker.com/get-docker/) (with Compose) and
Node 20+ with pnpm `10.32.1` (see the root [CLAUDE.md](../CLAUDE.md) toolchain section).

Step by step, from a clean checkout:

```bash
# 1. Install workspace deps + build @zenflow/shared (repo root, once)
pnpm install && pnpm shared:build

# 2. Bootstrap Postgres/Redis (x2 — session/OTP + rate-limit)/MailHog in the
#    background (from backend/)
docker compose -f compose.dev.yml up -d

# 3. Apply the Prisma schema to the dev DB
pnpm prisma:dev:migrate

# 4. Start the API in watch mode
pnpm start:dev            # http://localhost:5000, Swagger at /api
```

Other backend scripts (run inside `backend/`, or `pnpm --filter backend <script>`):

```bash
pnpm typecheck           # tsc --noEmit
pnpm lint                # eslint --fix
pnpm test                # jest unit tests (*.spec.ts)
pnpm test:e2e            # jest e2e (needs .env.test DB)

# Prisma (dev DB via .env.dev):
pnpm prisma:dev:studio   # browse the DB
pnpm prisma:gen:dev      # regenerate the Prisma client → ../generated/prisma
```

### Environment

`.env.{dev,staging,prod,test}` hold app config; the matching `docker.{dev,staging,prod,test}.env`
holds Postgres credentials for that Compose file. Required app vars (validated at boot via
`@hapi/joi`):

Copy `.env.example` to `.env.{dev,staging,prod,test}`:

```bash
cp .env.example .env.dev # same for .env.staging, .env.test, .env.prod
```

## Running staging

**Prerequisites:** Docker (with Compose) and Node 20+ — `build_images.sh` shells out to
`node` to read the image tag from `backend/package.json`; nothing else needs a local
install, the API itself runs inside the container.

`compose.staging.yml` is the fully containerized stack: `api` (built from the
`Dockerfile`), `postgres`, `redis` (sessions/OTP), `redis-ratelimit` (dedicated to
LimitKit's rate-limit counters — see "Rate limiting"), `mail` (MailHog — catches OTP
emails), and a `caddy` reverse proxy on `:80`, configured via `.env.staging` +
`docker.staging.env`. `compose.prod.yml` follows the same shape minus `mail`.

```bash
# From backend/ — build the zenflow-api image (build context is the repo root,
# since the API depends on the @zenflow/shared workspace package)
sh build_images.sh

# Bring the stack up in the background
docker compose -f compose.staging.yml up -d   # API via Caddy → :80, Swagger → :80/api
```

The Dockerfile is a multi-stage `node:20-alpine` build; `start:prod` runs
`prisma migrate deploy` before launching `dist/main` — so migrations are applied
automatically on container start, no separate migrate step needed for staging.

## Contributing

- **Formatter:** ESLint + Prettier (via `eslint-plugin-prettier`) — `pnpm --filter backend lint`
  runs `eslint --fix`. **2-space** indentation, double quotes, semicolons
  ([`.editorconfig`](../.editorconfig)).
- **Commits:** [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/),
  e.g. `feat(scheduler): …`, `fix(tasks): …`, `test(backend): …`.

See the repo-wide [**CONTRIBUTING.md**](../CONTRIBUTING.md) for setup, branching, and testing.
