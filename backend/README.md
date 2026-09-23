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
| Sessions &amp; cache | Redis via `ioredis` (custom `IoredisSessionStore` for sessions, `@nestjs/cache-manager` + keyv for cache/OTP)                     |
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
│   ├── sessions/               # session CRUD; create/deadline-edit place just the one
│   │   │                       #   TASK (or a series) — nothing else moves (see below)
│   │   ├── session-mapper.ts    # PURE — row → wire DTO / event snapshot
│   │   ├── session-events.ts    # PURE — CREATE / MOVE SessionEvent builders
│   │   ├── prisma-error.ts      # P2025 → 404 / else 500 mapper for update/remove
│   │   ├── types/session-row.ts # SessionRow (tags + series) + WITH_TAGS_AND_SERIES
│   │   └── ...
│   ├── reminders/              # per-session reminders: SchedulerRegistry timers → NotificationsService (see "Session reminders")
│   ├── scheduler/              # places ONE TASK / series — see "Scheduler architecture" below
│   │   ├── core/                # PURE algorithm — no Prisma, no clock, no randomness
│   │   │   ├── preference.ts        # matrixIndex / default+effective matrix / preferenceScoreAt
│   │   │   ├── slot-score.ts        # FROZEN FALLBACK: slotPreferenceScore (overlap-weighted) + bestFreeSlot
│   │   │   ├── series-spread.ts     # FROZEN FALLBACK: seriesDayWindows — non-overlapping per-member day buckets
│   │   │   ├── recurrence.ts        # rrule expand / occurrence-id helpers
│   │   │   ├── matrix-decay.ts      # exponential preference-matrix decay
│   │   │   ├── sync-conflicts.ts    # pure conflict detection
│   │   │   ├── slot.ts              # 15-min slot grid math, isoWeekday, overlap check
│   │   │   └── horizon.ts           # calendar math (period ceilings, calendar minutes)
│   │   ├── types/               # placement.types.ts, day-load.types.ts, context-vector.types.ts
│   │   └── io/                  # the ONLY Prisma / bandit-HTTP layer
│   │       ├── day-load.ts              # one day's occupied intervals + workload
│   │       ├── heuristic-placer.service.ts # HeuristicPlacer — placeTask / placeInWindow (frozen-fallback driver)
│   │       ├── fallback-placer.service.ts  # FallbackPlacer — Python-down degraded driver, built on HeuristicPlacer
│   │       ├── placement-client.service.ts # PlacementClient — timeout/retry/circuit-breaker HTTP to /v1/place
│   │       ├── placement-gateway.service.ts# PlacementGateway — builds PlaceRequest, two-phase infeasible call
│   │       ├── python-placer.service.ts    # PythonPlacer — gather/call/apply/persist, falls back on failure
│   │       ├── task-placement.service.ts   # TaskPlacementService — thin pass-through sessions/ calls
│   │       ├── displacement.service.ts     # applyMoves/isFlexible — persists Python's displacement plan
│   │       ├── scheduling-feedback.service.ts # delayed LinUCB MOVE reward
│   │       ├── retained-sessions.service.ts   # @Cron: RETAINED sweep (+ delayed LinUCB +1 reward)
│   │       └── matrix-decay.service.ts        # @Cron: daily preference-matrix decay
│   ├── bandit/                 # BanditService (HTTP client for services/bandit/) +
│   │                           #   BanditArmStateRepository (per-user (A,b) load/save)
│   ├── experiments/            # ExperimentService — 50/50 policy assignment + SlotProposal
│   ├── ingestion/             # DLU LMS/portal ingestion (issues #27/#29/#30)
│   │   ├── core/               # PURE parsers — no Prisma, no clock, no randomness
│   │   │   ├── semester.ts         # resolveSemester / isoWeek(sBetween) / monthsFrom — the portal's (academicYear, semester, tuan)
│   │   │   ├── period-map.ts       # teaching periods ("tiết") → wall-clock minutes
│   │   │   ├── grid.ts             # 15-minute grid snapping (invariant #3)
│   │   │   ├── parse-lms.ts        # Moodle monthly calendar → assignment / quiz blocks
│   │   │   ├── parse-portal.ts     # timetable + exam rows → lecture / exam blocks
│   │   │   └── types.ts            # ParsedBlock / ParsedLmsItem / ParsedPortalItem / SkippedItem
│   │   ├── lms-watcher.service.ts       # @Cron EVERY_HOUR — this month + next
│   │   ├── timetable-watcher.service.ts # @Cron 03:00 — this ISO week + next
│   │   ├── exam-watcher.service.ts      # @Cron 04:00 — the whole term, one request
│   │   ├── materializer.service.ts      # the write-back: Session + Notification, idempotent
│   │   ├── ingestion-jobs.service.ts    # per-run LmsSyncJob / PortalAPIJob + item rows
│   │   ├── ingestion-sync.service.ts    # the POST /integrations/:provider/sync seam
│   │   └── watcher-support.ts           # integration paging, sleep, job-item diagnostics
│   ├── lms/                   # LMSService — fetch-based Moodle client (login → sesskey, calendar)
│   ├── portal/                # PortalAPIService — student-portal client (auth, timetable, exams)
│   ├── integrations/          # encrypted DLU credential storage + live login probe
│   ├── notifications/         # the ingestion inbox — list, read, act-on, dismiss
│   ├── devices/               # native push — POST/DELETE /devices + FCM/APNs fan-out
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

**Key layering rule:** everything in `scheduler/core/` is **pure and deterministic** — no
database, no `new Date()`, no `Math.random()`; `now` is always passed in. `scheduler/io/*`
(the placers, `day-load`, the A/B facade, the feedback writer, and the two crons) is the
only layer that touches Prisma or the bandit HTTP service. Keep that split: it's what makes
the engine unit-testable and what the personalization work plugs into. The placers only ever
set `scheduledStartTime` on the session being created/edited — no existing session is moved
and no reschedule telemetry is written. Full walkthrough + diagrams:
[**Scheduler architecture**](#scheduler-architecture).

## Database schema

Defined in [`prisma/schema.prisma`](prisma/schema.prisma)

### `User`

| Field                       | Type       | Notes                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                        | uuid       | PK                                                                                                                                                                                                                                                                                                                                                                                 |
| `name`, `email`             | string     | `email` unique                                                                                                                                                                                                                                                                                                                                                                     |
| `timezone`                  | string     | IANA, default `"UTC"`                                                                                                                                                                                                                                                                                                                                                              |
| `lang`                      | `Language` | `VI_VN` \| `EN_US`, default `EN_US`. Not yet read by any endpoint.                                                                                                                                                                                                                                                                                                                 |
| `preferenceMatrix`          | float[]    | flat 168 signed floats (7 weekdays × 24 hours, row-major). +/−/0 = preferred/disliked/neutral. Read by the engine; decayed nightly; seeded lazily from the cold-start default. |
| `preferenceMatrixDecayedAt` | DateTime?  | last decay-cron pass; null until the first.                        |
| `onboardingComplete`        | bool       | always `true`; no onboarding flow. Unused.                         |

Per-user working-hours (`workStart`/`workEnd`/`workDays`) were dropped — the scheduler
places across the full 24h grid, every day. See [Scheduler architecture](#scheduler-architecture).

### `Session`

| Field                           | Type            | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                            | uuid            | PK                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `title`, `note`                 | string          | `note` is rich text (TipTap)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `location`                      | string?         | free-text room/building; DLU watchers write the upstream room here. Not read by the scheduler. |
| `durationMinutes`               | int             | always a positive multiple of 15.                                 |
| `deadline`                      | DateTime?       | set for `TASK`, null for fixed types. Placement ordering key.     |
| `tags`                          | `Tag[]`         | implicit m2m (per-user labels).                                   |
| `type`                          | `SessionType`   | `TASK` (engine-placed) \| `ASSIGNMENT` \| `EXAM` \| `LECTURE` \| `DND` (user-pinned). |
| `source`                        | `SessionSource` | `USER` \| `LMS` \| `PORTAL`.                                      |
| `conflict`                      | bool            | overlaps another interval, or unplaced. Overlap is accepted — nothing auto-relocates. |
| `deleted`                       | bool            | soft-delete flag, default `false`. A user-initiated delete sets this instead of removing the row (see `DELETE /sessions/:id` below); every read that feeds scheduling or calendar display filters `deleted: false`. The materializer's own `[userId, externalKey]` lookup is the deliberate exception — it must see a soft-deleted row so it can skip re-creating it. |
| `scheduledStartTime`            | DateTime?       | engine placement (`TASK`) / client instant (fixed); null while unplaced. |
| `lastMovedAt` / `retainedAt`    | DateTime?       | move-or-keep bookkeeping (ADR-0002 §2.1).                         |
| `syncConfirmedAt` / `syncMissedAt` | DateTime?    | two-consecutive-run confirmation gate for an ingested row (issue #60/#62): `syncConfirmedAt` null means "created but not yet confirmed by a second watcher run" (on the calendar, but its notification is held back); `syncMissedAt` set means "missing on the last run, one miss so far" — a second consecutive miss is what actually soft-deletes it. Always null for a user-created session. See "Write-back" below. |
| `userId`                        | uuid            | FK → `User`, cascade.                                             |
| `seriesId`                      | uuid?           | FK → `SessionSeries`, cascade. Set for a recurring fixed representative and every sitting of a `sessionCount > 1` `TASK` series. |
| `sessionIndex` / `sessionTotal` | int?            | 1-based position / total within a `TASK` series (denormalized).   |
| `externalKey`                   | string?         | upstream DLU item id (`"<source>:<kind>:<id>"`); null for user sessions. Unique per `[userId, externalKey]` — the ingestion idempotency guard. |
| `scheduleStudyUnitId`            | string?         | portal `ScheduleStudyUnitID` — set only on a portal-ingested `LECTURE`, shared by every meeting of that class across the term (there is no `SessionSeries` for these — one flat row per meeting). Null everywhere else, including a user-created recurring `LECTURE`. The grouping key for `DELETE /sessions/timetable-group/:sessionId[/from]`. |

Indexes: `[userId, deadline]`, `[userId, scheduledStartTime]`,
`[userId, seriesId, createdAt asc]`, `[userId, scheduleStudyUnitId]`;
unique `[userId, externalKey]`.

### `SessionReminder`

| Field                 | Type      | Notes                                                                                                   |
| --------------------- | --------- | ------------------------------------------------------------------------------------------------------- |
| `id`                  | uuid      | PK; the timer is named `reminder:<id>` in `SchedulerRegistry`.                                          |
| `remindBeforeMinutes` | int       | 0…10080 (0 = at start) (`MAX_REMINDER_MINUTES`).                                                                       |
| `firedForStart`       | DateTime? | start of the occurrence last fired for — dedupes across restarts/re-arms; per-occurrence for a series. |
| `sessionId`           | uuid      | FK → `Session`, cascade. At most 2 per session (`MAX_REMINDERS_PER_SESSION`); never on `DND`.          |

### `SessionEvent` (append-only audit trail — the ML fuel)

| Field                         | Type               | Notes                                                         |
| ----------------------------- | ------------------ | ------------------------------------------------------------- |
| `id`                          | BigInt             | autoincrement (serialized as decimal string over the wire)    |
| `eventType`                   | `SessionEventType` | `CREATE` \| `MOVE` \| `RESIZE` \| `RETAINED` \| `SYSTEM_MOVE` (scheduler-initiated, reward 0) |
| `oldSnapshot` / `newSnapshot` | Json               | `{ scheduledStartTime, durationMinutes, tags }`               |
| `rewardScore`                 | float              | LinUCB reward signal (default 1.0)                            |
| `occurredAt`                  | DateTime           | indexed desc per user                                         |
| `sessionId` / `userId`        | uuid               | FKs, cascade delete (`userId` denormalized for range queries) |

### `Tag`

Per-user label in an implicit many-to-many with `Session`.

| Field       | Type     | Notes                                        |
| ----------- | -------- | -------------------------------------------- |
| `id`        | uuid     | PK                                           |
| `name`      | string   | unique per user (`@@unique([userId, name])`) |
| `userId`    | uuid     | FK → `User`, `onDelete: Cascade`             |
| `createdAt` | DateTime |                                              |

The wire format is `Session.tags: string[]` of names; the backend upserts unknown names
per-user inside the task transaction. The `Tag` table is a backend detail.

### `File`

`id`, `originalName`, `filename`, `path`, `mimetype`, `size`, `userId` (cascade).

### `UserDevice`

`id`, `platform` (`IOS` \| `ANDROID`), `pushToken` (**unique** — the raw FCM/APNs token,
the natural key), `lastSeenAt`, `userId` (cascade). One row per (device, provider);
registration upserts on `pushToken`. See `devices/` and `POST /devices`.

### DLU ingestion tables

| Table                               | Purpose                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `LmsCourse`                         | A Moodle course from the LMS calendar response's `course` block. Deduped on `lmsCourseId` (Moodle `course.id`).                                                                                                                                                                                                                      |
| `PortalSection`                     | One student-portal course section — curriculum unit × term × group × teacher × room. Deduped on `scheduleStudyUnitId`; indexed `[yearStudy, termId]`, the access path for a whole-term refresh.                                                                                                                                      |
| `LmsSyncJob` / `LmsSyncJobItem`     | Per-run tracking for the LMS watcher; one item per request (`url`, `attempt`, `statusCode`, `responseBody` kept for diagnosis).                                                                                                                                                                                                       |
| `PortalAPIJob` / `PortalAPIJobItem` | Same shape for the portal poller.                                                                                                                                                                                                                                                                                                   |
| `Notification`                      | Raised by the materializer for a new/changed/removed ingested item. `eventName` (a stable slug like `"assignment.created"`, `"lecture.removed"`, `"sync_conflict.exam"`) is the sole machine-readable classification — clients derive `CREATED`\|`UPDATED`\|`REMOVED`\|`CONFLICT` via `notificationEventKind()` and `ASSIGNMENT`\|`EXAM`\|`LECTURE`\|`REMINDER` via `notificationCategory()` (both `@zenflow/shared`) from it rather than separate `eventType`/`topic` columns; `title`/`content` remain free text for display only. `eventEndsAt` (due/at time; null for grouped rows and removals), `sessionId` (target session); a term of lectures is one grouped `lecture.group_*` row. |

`LmsCourse` and `PortalSection` are deliberately never joined — no shared identifier, and
each ingestion path uses only its own system's data.

> **Session model.** A `POST /sessions` creates one `Session`, or — for a `TASK` with
> `sessionCount > 1` — a materialized series of N rows sharing a `seriesId`. A recurring
> fixed session (`DND` / `ASSIGNMENT` / `EXAM` / `LECTURE` with an `rrule`) is a virtual
> series: one `SessionSeries` + one representative row, fanned out into occurrences at read
> time. See invariant #4 in [CLAUDE.md](../CLAUDE.md) and
> [ADR-0002](../docs/adr/0002-scheduling-simplification.md) §2.4.

## DLU ingestion

Pulls a student's Moodle assignments/quizzes, class timetable and exam schedule onto their
calendar. **API-only** — the LMS and the portal both expose JSON, so there is no crawling,
no HTML scraping and no headless browser anywhere in the image.

Same layering rule as the scheduler: `ingestion/core/*` is **pure** (no Prisma, no
`new Date()`, no randomness — `now` and the timezone are always parameters), and only the
HTTP clients in `lms/` and `portal/` do I/O.

### Clients

| Call                                                                   | Endpoint                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LMSService.login(username, password)`                                 | 4 steps: `GET /login/index.php` (scrape `logintoken`) → `POST /login/index.php` (`redirect: "manual"`; Moodle **regenerates** `MoodleSession`, so the cookie on _this_ response is the authenticated one) → `GET /my/` → `sesskey` out of the inline `M.cfg`. Returns `{ ok: false, reason: "INVALID_CREDENTIALS" }` for a rejected password; throws only on a real outage. |
| `LMSService.fetchMonthlyView(session, year, month)`                    | `POST /lib/ajax/service.php?sesskey=…&info=core_calendar_get_calendar_monthly_view`. `month` is 1-based.                                                                                                                                                                                                                                                                    |
| `PortalAPIService.authenticate(username, password)`                    | `POST /api/authenticate/authpsc` → `Token`.                                                                                                                                                                                                                                                                                                                                 |
| `PortalAPIService.fetchTimetable(token, academicYear, semester, tuan)` | `GET /api/student/DrawingStudentSchedules` — one ISO week of meetings.                                                                                                                                                                                                                                                                                                      |
| `PortalAPIService.fetchExams(token, academicYear, semester)`           | `GET /api/student/exam` — a whole term.                                                                                                                                                                                                                                                                                                                                     |

`sesskey` is a per-session CSRF token Moodle renders into the page body (`M.cfg`, hidden
inputs, printed URLs) — never a cookie, never a header, which is why it is invisible in the
Network tab. It is bound to `MoodleSession` and rotates with it, so it is held in a local
variable for one watcher run and never cached. Portal calls carry
`Authorization: Bearer <token>`, `Clientid: vhu` and `Apikey` (from `PORTAL_API_KEY`; never
hardcoded, never logged). Timeouts come from `LMS_TIMEOUT_MS` / `PORTAL_API_TIMEOUT_MS`.

### Parsers (`ingestion/core/`)

- **`semester.ts`** — the portal is addressed by academic coordinates, not dates.
  `resolveSemester(now, tz)` → `{ academicYear, semester, startDate, endDate }`. Term
  boundaries are **weeks**, never month ends, so a `tuan` is never split across two terms:
  HK01 opens the last week of July, HK02 the last week of December, HK03 the last week of
  May, and HK03 closes on the week before the next HK01 (`academicYear` only rolls there).
  The term is resolved `SEMESTER_LOOKAHEAD_WEEKS` (2) ahead of `now`, so the watchers move
  onto a new term a fortnight before it opens and nobody sees an empty calendar on day one —
  `startDate` is then legitimately in the future. `isoWeek(date, tz)` → one `tuan`;
  `isoWeeksBetween(from, to, tz)` → every `tuan` in a window, walking the calendar a Monday
  at a time because the numbers wrap 52/53 → 1 inside HK02.
- **`period-map.ts`** — the timetable never returns clock times, only teaching periods.
  1–4 = 07:30–11:10 (20-min break after 2), 7–10 = 13:00–16:30 (10-min break after 8),
  11–14 = 16:40–20:00. **Periods 5–6 are undocumented**, so any span touching them returns
  `null`, the row is skipped, and the reason is returned for the job item — guessing would
  silently put a class on the calendar at the wrong hour.
- **`grid.ts`** — DLU times are routinely off-grid (a 4-period lecture is 220 minutes; the
  evening block starts at 16:40), so every block is snapped **outward** (start down, end up)
  to keep invariant #3: 07:30–11:10 ⇒ 07:30 + 225 min, 16:40–20:00 ⇒ 16:30 + 210 min.
- **`parse-lms.ts`** — keeps `assign` and `quiz` events that sort after `now`; `attendance`
  is explicitly excluded. Moodle's `timestart` **is already a real Unix epoch** — never
  re-zone it into VN time. A quiz emits **two events sharing one `instance`**
  (`eventtype: "open"` / `"close"`) with different event ids, so quizzes are grouped by
  `instance`, which is also the `externalKey` identity (an event id changes when a teacher
  re-creates a due date). Window ≤ 200 min ⇒ one contiguous `EXAM` block; longer, or a lone
  `close`, ⇒ a 15-minute reminder before the close; a lone `open` is skipped (its close
  arrives in the next month's fetch — which is why two months are fetched).
- **`parse-portal.ts`** — timetable rows become one `LECTURE` per meeting; exam rows parse
  `NgayThi` (`dd/MM/yyyy`), `GioThi` (`"07g30"` — `g` for _giờ_) and `ThoiLuong` (minutes,
  rounded up to a multiple of 15). Wall-clock → UTC always goes through
  `common/utils`' `minutesToUtc`, never hand-rolled timezone math.

`externalKey` is what makes a re-run idempotent (`@@unique([userId, externalKey])`):
`lms:assign:<instance>`, `lms:quiz:<instance>`, `portal:meeting:<WeekScheduleID>`,
`portal:exam:<Examination>`.

### Watchers (the three crons)

Same house shape as the scheduler's crons (`scheduler/io/matrix-decay.service.ts`): a thin
`@Cron` delegating to a testable `run(now = new Date(), userId?)` that takes its clock as a
parameter. `userId` narrows the sweep to one student — that is the manual sync endpoint,
running the _same_ code rather than a second path that could drift.

| Service                        | Cron               | Requests per student per run                                                                                                  |
| ------------------------------ | ------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `lms-watcher.service.ts`       | `EVERY_HOUR`       | 2 — the current month and the next (a quiz opening on the 30th and closing on the 2nd is only a complete pair in one of them) |
| `timetable-watcher.service.ts` | `EVERY_DAY_AT_3AM` | ≤ 22 — every ISO week left in the resolved `(academicYear, semester)`, from the current week to the term's last               |
| `exam-watcher.service.ts`      | `EVERY_DAY_AT_4AM` | 1 — `/api/student/exam` returns a whole term                                                                                  |

The LMS gets the hourly slot because a deadline can be published or moved at any time; a
timetable and an exam schedule change a handful of times a term, so polling them hourly
would be almost entirely wasted requests. The timetable trades width for that low frequency:
one daily run walks the rest of the term rather than just the next fortnight, so a student
who looks months ahead sees real classes, and a mid-term room or time change still lands.
The sweep shrinks by a week every week. Every run gates on `INGESTION_ENABLED` first.

Each run: page the `Integration` rows for the provider (cursor-paginated, 50 at a time),
process students **sequentially** with a fixed `INGESTION_REQUEST_DELAY_MS` pause between
outbound requests, decrypt via `IntegrationsService.revealCredentials`, **log in once** and
reuse the session/token for the whole run, then parse, upsert the course catalog
(`LmsCourse` by `lmsCourseId`, `PortalSection` by `scheduleStudyUnitId`) and hand the blocks
to the materializer. Politeness is deliberately this trivial — no queue, no rate limiter, no
circuit breaker; those are deferred and the layering is shaped so they land additively.

Portal wall-clock strings are converted using the student's own `User.timezone`, falling
back to `DLU_TZ`; the academic coordinates (`academicYear`, `semester`, `tuan`) are always resolved in
`DLU_TZ`, since they are a property of the university's calendar rather than the student's.

**Job tracking.** One `LmsSyncJob` / `PortalAPIJob` per student per run
(`PENDING → PROCESSING → COMPLETED | FAILED`) tied to the `Integration`, and one `*JobItem`
per outbound request (`url`, `attempt`, `statusCode`, `responseBody`). An item is written
`PROCESSING` _before_ the request, so a process killed mid-flight leaves evidence of which
call hung. `responseBody` holds `{ body, skipped, error? }` — the raw upstream payload plus
the parser's `SkippedItem[]`, because "this payload produced nothing" is a bug report while
"…_because periods 5–6 are undocumented_" is an answer. A failed item stays `FAILED` and the
run continues; only a **login** failure fails the job, because without a session there is no
request to attach the failure to. These rows are not mere diagnostics: they are what
`IntegrationStatus.lastSyncedAt` / `.lastSyncStatus` are derived from.

Nothing wraps N writes in one interactive `$transaction` — `PrismaService` sets a 20s
timeout and warns about exactly that; every item is its own small transaction.

### Write-back (`materializer.service.ts`)

An ingested item lands on the calendar **and** raises a notification, whose call to action
is "plan work around this", not "confirm this item" — it already exists upstream.

- **Session** — inserted through `sessions/fixed-session-writer.ts`'s `insertFixedSession`,
  the same insert `SessionCrudService` uses for a user-pinned fixed session, so `source`,
  `externalKey` and the `CREATE` `SessionEvent` cannot drift between the two paths. The HTTP
  DTO is not reusable here: `CreateSessionDto` has no `source` field and sits behind
  `forbidNonWhitelisted`. `ParsedBlock.location` is written straight to the `Session.location`
  column; an ingested fixed session carries no `note` (the portal exam format `HinhThucThi`
  is dropped on parse).
- **Idempotent** on `[userId, externalKey]`, so an hourly re-run of the same window is a
  no-op; `P2002` is the race signal for two runs overlapping on one item.
- **Plain sync, upstream wins.** Upstream is authoritative: a change is always applied
  (`applyUpstreamChange`, raising a `CHANGE` notification) and a removal always
  soft-deletes the row (`deleted: true`, raising a `DROP` notification) — regardless of
  whether the student had since moved it by hand. `applyUpstreamChange` writes no
  `SessionEvent` and never sets `lastMovedAt`; both mean "the user did this", and
  fabricating one would feed the LinUCB reward signal a move nobody made.
- **Respects a student's own deletion.** The one exception to "upstream wins" is a row the
  student has themselves soft-deleted (`SessionCrudService.remove`, or a series-wide
  delete): the still-unique `externalKey` lets `materialize()`'s `userId_externalKey`
  lookup see the soft-deleted row and skip it entirely (`outcome.skippedDeleted`) instead
  of resurrecting it on the next re-fetch.
- **A quiet re-run is quiet**: notifications are raised only for genuinely new, changed or
  removed items.
- **`eventName` classifies the event; `title`/`content` are display-only.** Every
  `raise()` call sets a stable slug `eventName` (`"assignment.created"`, `"lecture.removed"`,
  `"timetable.group_created"`, `"sync_conflict.exam"`, …) so a client can switch on it
  instead of pattern-matching the free-text title/content. It also encodes the coarse
  `CREATED`\|`UPDATED`\|`REMOVED`\|`CONFLICT` classification — `notificationEventKind()`
  (`@zenflow/shared`) derives it from the slug rather than a separate column, so there is
  one field to keep in sync, not two (e.g. `announceLectureChanges` titles "New lectures: …" vs
  "Updated lectures: …"). Each per-item assignment/exam/lecture row also gets an
  `eventEndsAt` (its `scheduledStartTime + durationMinutes`, the "due"/"at" time the inbox
  shows); grouped and removal rows leave it null. User-facing copy says
  **"semester 1/2/3"** (`termLabel`), never the portal's `HK0x`.
- **A single-run blip must not notify or delete (the confirm gate, issue #60/#62).** A
  first sighting of an upstream item writes the `Session` row immediately (visible on the
  calendar right away) but leaves `syncConfirmedAt` null and raises **no** notification —
  `create()`'s caller in `materialize()`'s main loop skips straight past `raise()`. Only once
  the *same* `externalKey` survives a second consecutive run does `confirmPending()` stamp
  `syncConfirmedAt` (re-applying the block's latest fields, since upstream may have refined
  them between the two sightings) and finally raise the "new item" notification. Symmetrically
  in `reconcileDeleted`: a *confirmed* item missing from one run just gets `syncMissedAt`
  stamped and is otherwise left exactly as-is — no soft-delete, no notification — and only a
  *second* consecutive miss (the row still has `syncMissedAt` set) soft-deletes it and raises
  the removal notification, same as before. The moment a confirmed item reappears,
  `syncMissedAt` is cleared back to null regardless of anything else about the row also having
  changed. A still-pending item (never confirmed) that vanishes before its second sighting is
  **hard**-deleted (`prisma.session.delete`, not soft) since it was never a real, user-facing
  item — no `Notification` FK to worry about, no notification either.
- **A term's timetable is one notification.** Lecture creates/updates are held back and
  folded into a single per-term row: once ≥ 10 lectures are on the calendar for the term it
  is `"Timetable for semester 1 is available"` (raised once, then deduplicated on its title
  so the ~20 weekly batches of a first-of-term sync do not each mint one), and its
  `sessionId` is the earliest meeting so the row still lands the calendar on the term.
  Below the threshold it lists the class names (`"New lectures: A, B, C +2 more"`).
  Assignments and exams stay one notification each — those are individually actionable.
- **Handles upstream deletion** (`reconcileDeleted`). Each watcher accumulates every
  `externalKey` it saw across its whole run and, **only if every fetch succeeded**, hands
  them here; any ingested `(source, type)` session that starts inside the run's forward
  window (term end for the portal, the last fetched month for the LMS) but is not in that
  set has been dropped upstream — a cancelled class, a withdrawn exam, a deleted assignment.
  A *confirmed* session gets exactly one free miss (`syncMissedAt` stamped, left alone); its
  second consecutive miss soft-deletes it (`deleted: true`, no `SessionEvent`; the
  `Notification` FK is `SetNull`) and raises the removal notification, regardless of whether
  the student had since hand-moved it (hand-moved rows are kept from the first miss on,
  never touched). A still-*pending* session is hard-deleted outright on its first miss — see
  the confirm gate above. The removal notification groups exactly like a creation does for
  lectures, one-per-item for assignments/exams.

## API endpoints

Global prefix `**/api/v1**`. All routes except `POST /auth/otp/*` require
`CookieAuthGuard` (a valid Redis session cookie). Success responses use the
`@zenflow/shared` envelope `{ success: true, message?, data }`; errors use
`{ success: false, message, statusCode?, field? }`.

### Auth (`/auth`)

| Method | Path                | Purpose                                                                                                               |
| ------ | ------------------- | --------------------------------------------------------------------------------------------------------------------- |
| POST   | `/auth/otp/request` | email a 6-digit OTP (no guard; rate-limited)                       |
| POST   | `/auth/otp/verify`  | verify, create user if new, start session. Reads `x-timezone`. (`LocalAuthGuard`; rate-limited) |
| GET    | `/auth/me`          | current user                                                       |
| POST   | `/auth/logout`      | destroy session                                                    |

### Users (`/users`)

| Method | Path                          | Purpose                                                                                                                                            |
| ------ | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/users/me`                   | profile                                                            |
| PATCH  | `/users/update/basic-info`    | update name/email                                                  |
| GET    | `/users/me/preference-matrix` | the 168-float preference matrix for the Insights heatmap (`PreferenceMatrixResponse`). |

No onboarding or preferences-update endpoint. `timezone` is captured once at OTP signup
(`x-timezone` header) and never edited after.

A brand-new signup also seeds 4 daily-recurring `DND` blocks (Breakfast 06:00–07:00, Lunch
11:00–13:00, Evening 17:00–19:00, Sleep 22:00–06:00) via the normal `DND` + `rrule` path,
so the scheduler avoids them from day one. Best-effort — a failure is logged and swallowed.

### Sessions (`/sessions`)

`@Controller("sessions")` — no `/tasks` route. Drag, resize and reschedule are all one
`PATCH /sessions/:id` (recorded as a `MOVE` signal). No status/completion, `/reschedule`,
`/resize`, `/optimize` or `/undo`.

**Displacement / infeasible deadline (issue #62 B).** When a single `TASK` create or deadline edit
has no free slot, `TaskPlacementService.preflightTask` first repacks flexible tasks (EDF) on the
deadline day (+/-1 day if needed). Fixed blocks and series sittings never move. Moved rows come back
in `displacedSessions[]` as `SYSTEM_MOVE` events (reward 0).

If that fails too: `409 { success:false, code:"SCHEDULE_INFEASIBLE",
options:["ACCEPT_CONFLICTS","ACCEPT_LATE_DEADLINE"] }`, nothing persisted. The client retries with
`infeasiblePolicy` (`POST`/`PATCH` bodies). `ACCEPT_LATE_DEADLINE` places the task after the
deadline and returns `late: true`. `now + duration > deadline` is a `400` on create and on a
deadline edit. Every `Session` carries `late: boolean`.
`POST` and `PATCH` accept `reminders?: number[]` (minutes before start, max 2 distinct ints in
0…10080 (0 = at start), not for `DND`); every `Session` response carries `reminders: number[]` (descending;
`[]` for DND). On create, omitted → one default reminder at 60 min (non-DND), `[]` → none. On
PATCH, omitted → unchanged, an array replaces. On a materialized `TASK` series the list applies
to every sitting; on a recurring fixed occurrence id it edits the series' representative (so
all occurrences). Violations → 400.

| Method | Path                                         | Purpose                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------ | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/sessions`                                  | Create. A `TASK` → its best free slot (or, `sessionCount > 1`, a materialized series across `now…deadline`); a fixed/`DND` session at the given `scheduledStartTime` + optional `rrule`. Only when a `TASK` has no free slot before its deadline are flexible tasks repacked (see *Displacement* below). |
| GET    | `/sessions?view=&date=`                      | List the `day`/`week`/`month` window + unplaced. Recurring series fanned to virtual rows. |
| GET    | `/sessions/suggestions?q=&limit=`            | Title autocomplete (newest first, deduped by normalized title — a series' sittings, or a re-created title, collapse to the most recent). `limit` 1–50, default 10. |
| GET    | `/sessions/deadline-options?anchor=`         | The six deadline quick-chip instants relative to `anchor`.        |
| GET    | `/sessions/:id`                              | Detail. Recurring occurrence id: `"<seriesId>::<startISO>"` (URL-encoded). |
| PATCH  | `/sessions/:id`                              | `UpdateSessionDto` — metadata, drag/resize, `rrule`, `sessionCount`. `scope` + `skipConflicting` narrow a series change; `sessionCount` grows/shrinks a `TASK` series (or promotes a plain `TASK` into one); may return `sessions[]` + `skippedSessionIds`. |
| DELETE | `/sessions/:id`                              | Soft-delete one (`deleted: true`, row kept so an ingested item's `externalKey` isn't recreated on the next DLU sync); on an occurrence id, add the date to `exdates` instead. Returns `{ id }`. |
| DELETE | `/sessions/series/:seriesId`                 | Delete the whole series.                                          |
| DELETE | `/sessions/series/:seriesId/truncate?from=`  | Recurring series only — pull the rrule's `UNTIL` back to just before `from` ("this and following").                                                                                                                                                                                                                                                                                                              |
| DELETE | `/sessions/series/:seriesId/from/:sessionId` | Materialized `TASK` series only — delete that sitting and every later one by `sessionIndex`; earlier sittings kept.                                                                                                                                                                                                                                                                                              |
| DELETE | `/sessions/timetable-group/:sessionId/from`  | Portal-ingested `LECTURE`s only (no `SessionSeries`) — soft-delete that meeting and every later one sharing its `scheduleStudyUnitId` (the portal course-section id). 404 if not the caller's or not groupable (no `scheduleStudyUnitId`). Returns `RemoveTimetableGroupResponse` (`{ removedSessionIds }`). |
| DELETE | `/sessions/timetable-group/:sessionId`       | Same grouping, unconditional on time — soft-deletes every meeting in the section. Same 404s/response shape.                                                                                                                                                                                                                                                                                                     |
| POST   | `/sessions/:id/slot-pick`                    | `{ slotProposalId, chose: "primary" \| "alternative" }` — records which side of a pairwise-sampled `SlotProposal` the user picked (`pairwiseShown` events only); `"alternative"` applies that start as an ordinary `MOVE`. Idempotent, best-effort — never blocks the flow. See [LinUCB scheduling](#linucb-scheduling-ab-experiment). |

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

| Method | Path                           | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------ | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/integrations`                | Connect. Body `{ provider, username, password }`. Live-login probe first (`400` rejected / `503` unreachable, no write), then encrypt + upsert. |
| GET    | `/integrations`                | `[{ provider, connected, lastVerifiedAt, lastSyncedAt, lastSyncStatus }]` — the sync pair comes from the newest job row. |
| PATCH  | `/integrations/:provider`      | Update credentials. Body `{ username?, password? }`. Same probe-then-write. |
| DELETE | `/integrations/:provider`      | Disconnect. Idempotent; keeps the `UserEncryptionKey`.              |
| POST   | `/integrations/:provider/sync` | Run this student's watchers now. `404` if not connected. Returns that provider's `IntegrationStatus`. |

### Notifications (`/notifications`)

The ingestion inbox — written by the materializer, never a client (no create route).
`CookieAuthGuard` per route, own rows only. Types: `NotificationDto`,
`NotificationsListResponse`. `eventName` (a stable slug, e.g. `"assignment.created"`,
`"lecture.removed"`, `"sync_conflict.exam"`) is the sole machine-readable classification,
safe to switch on — `notificationEventKind()` derives the coarse `CREATED`\|`UPDATED`\|
`REMOVED`\|`CONFLICT` kind from it, and `notificationCategory()` derives
`ASSIGNMENT`\|`EXAM`\|`LECTURE`\|`REMINDER` (both `@zenflow/shared`); there is no separate
`eventType`/`topic` column for either. Sync-conflict rows use a `sync_conflict.<category>`
`eventName` (`sync_conflict.lecture` / `.exam` / `.assignment`), raised by
`ingestion/sync-conflicts.service.ts` after each source's sync. `conflictSessionIds` lists the
user's clashing tasks; no calendar session is created. `title`/`content` remain free text for
display. For a per-item assignment/exam/lecture, there's also an `eventEndsAt` (the
"due"/"at" time; null for grouped rows and removals).

| Method | Path                              | Purpose                                                     |
| ------ | --------------------------------- | --------------------------------------------------------- |
| GET    | `/notifications?limit=&offset=`   | One page, newest first. `unreadCount` counts the whole inbox. |
| PATCH  | `/notifications/:id/read`         | Stamp `readAt`. Idempotent; `404` if not the caller's.   |
| PATCH  | `/notifications/:id/action-taken` | Stamp `actionTakenAt` (distinct from read). Idempotent.  |
| DELETE | `/notifications/:id`              | Dismiss (hard delete, caller-scoped).                    |
| POST   | `/notifications/:id/reschedule-conflicts` | `*_CONFLICT` rows only (`404` otherwise): re-places every listed task that still overlaps (EDF, `SYSTEM_MOVE` events), stamps `actionTakenAt`. Idempotent. Returns `{ rescheduled[{id,from,to}], failedSessionIds[] }`. |
| POST   | `/notifications/dev/raise`        | **Dev only** (`404` when `NODE_ENV=production`), no guard. Body `{ userId, count? }` — raises fake rows in-process so the SSE stream + push fire. Driven by `scripts/send-test-notification.ts`. |

The live channel is SSE — see [Live notifications](#live-notifications-sse).

### Devices (`/devices`)

Native-push device registry. `CookieAuthGuard`; no list route. Types: `RegisterDeviceInput`,
`UnregisterDeviceInput`, `PushDataPayload`.

| Method | Path       | Purpose                                                                          |
| ------ | ---------- | ------------------------------------------------------------------------------- |
| POST   | `/devices` | Register/refresh. Body `{ platform, pushToken }`. Upserts on `pushToken` (idempotent). |
| DELETE | `/devices` | Unregister by token. Body `{ pushToken }`. Idempotent, caller-scoped.          |

`PushService` subscribes to `NotificationsService.notificationEmitter` (alongside the SSE
stream) and fans each notification out via `FcmSender` (Android) / `ApnsSender` (iOS). Both
self-disable when their env is unset (`FCM_SERVICE_ACCOUNT`; the four `APNS_*`). Dead tokens
(FCM `registration-token-not-registered`, APNs `410` / `Unregistered` / `BadDeviceToken`)
are pruned on send.

### Live notifications (SSE)

`GET /notifications/stream` — `@Sse`, `text/event-stream`, cookie-auth. The materializer
emits on `NotificationsService.notificationEmitter`; the stream forwards each new
`NotificationDto` for the current user. Used by the web bell for live updates; mobile
consumes it for foreground delivery.

`notificationEmitter` is a plain in-process `EventEmitter2` — a separate Node process (a
standalone script, another instance) that emits on its own copy reaches no SSE client here.

To exercise the inbox + stream + push without a DLU sync or cron changes, with
`start:dev` already running:

```bash
pnpm --filter backend exec ts-node scripts/send-test-notification.ts <userId> [count]
```

It `POST`s to the dev-only `/notifications/dev/raise`, which writes real `Notification`
rows and emits `NEW_SESSION` **inside the running server**, so the SSE stream and
`PushService` both fire. Set `API_URL` if the server isn't on `:5000`.

`IntegrationAuthService` only does a pass/fail probe; parsing belongs to `ingestion/core/`.
The probe's return/throw split is what produces the two status codes: it returns `false`
when DLU answers and **rejects** the credentials (`400`), and throws only when DLU is
unreachable or answers incomprehensibly (`503`). `LMSService.login` therefore reports a
wrong password as `{ ok: false, reason: "INVALID_CREDENTIALS" }` rather than throwing.

Full live schema: **Swagger UI at `<API_URL>/api`**.

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

DLU ingestion config (all validated with defaults, so a deployment that omits them still
boots): `LMS_URL` / `PORTAL_API_URL` (upstream base URLs — read with `getOrThrow` at
service construction, which is why they must always resolve), `LMS_TIMEOUT_MS` (15000) /
`PORTAL_API_TIMEOUT_MS` (10000) per-request timeouts, `DLU_TZ` (`Asia/Ho_Chi_Minh` — the
timezone the upstream wall-clock strings are in, not the user's), and `INGESTION_ENABLED`
(kill switch for the watcher crons; `false` in `.env.test` so a test run can never reach
DLU) and `INGESTION_REQUEST_DELAY_MS` (750; the fixed pause between a watcher's outbound
requests — the entirety of the baseline's politeness policy, so it is config rather than a
constant; `0` in `.env.test`). `PORTAL_API_KEY` stays required with no default.

`BANDIT_SERVICE_URL` (optional, dev `http://localhost:8100`) points at the stateless Python
bandit service (`services/bandit/`), which owns ALL placement ranking (ADR-0003). When unset
(or unreachable), every placement is served by the frozen TS `FallbackPlacer` instead — degraded
but functional. **`BANDIT_SERVICE_URL` is required when `NODE_ENV=production`** (config
validation fails boot). See
[Python-authoritative placement](#python-authoritative-placement-adr-0003). Other placement
flags:

- `BANDIT_SERVICE_TOKEN` (optional): bearer secret for `POST /v1/place`
- `PLACE_TIMEOUT_MS`: default 2500
- `BENCH_TIMING=1`: test env, emits a `Server-Timing` header

Native push config (all optional, each provider self-disables when its vars are unset —
same pattern as `BANDIT_SERVICE_URL`; unset in `.env.test`): `FCM_SERVICE_ACCOUNT` (base64
of the Firebase service-account JSON) enables Android/FCM; `APNS_KEY` (base64 of the `.p8`
auth key) + `APNS_KEY_ID` + `APNS_TEAM_ID` + `APNS_BUNDLE_ID` (+ `APNS_PRODUCTION`, default
`false`) enable iOS/APNs. A VAPID-style `_V<n>` suffix is deliberately absent — rotating
either credential just forces the mobile app to re-register, it is not a decrypt-old-rows
concern.

## Python-authoritative placement (ADR-0003)

[ADR-0003](../docs/adr/0003-python-authoritative-placement.md): Python (`services/bandit`,
`POST /v1/place`) is the **sole** placement-ranking path — heuristic best-free-slot, LinUCB
slot-first scoring, series spreading, displacement (EDF repack), and the two infeasible
fallbacks (`ACCEPT_CONFLICTS`, `ACCEPT_LATE_DEADLINE`) all live there now
(`services/bandit/src/core/*`, pure numpy). Nest's job is thin: gather inputs, call, apply,
persist. Phase 6 (deleting the legacy/shadow TS ranking code and the
`SCHEDULER_PLACEMENT_MODE` flag that gated the earlier rollout) has landed — see the ADR's
"Phase 6 executed (out of sequence)" note for the accepted risk of skipping the shadow-soak
gate.

`TaskPlacementService` (`scheduler/io/task-placement.service.ts`) is a pass-through: it owns
only the `now + duration > deadline` arithmetic pre-check and the series-deadline-change
transaction, and otherwise delegates straight to `PythonPlacer`.

Pieces (`scheduler/io/`):

- `PlacementClient`: bearer token, 2.5 s total timeout (no separate connect timeout; `fetch` has none).
  One retry on connect-refused/reset/502-504 that failed within 300 ms; never on a timeout or 4xx.
- `circuit-breaker.ts`: opens after 5 consecutive failures, for 15 s. Then one half-open probe;
  a failed probe doubles the open time (cap 60 s). 4xx/contract errors fall back without tripping it.
- `PlacementGateway`: builds the `PlaceRequest` (`loadDayLoads`, observation count, bandit `(A, b)`),
  runs the two-phase infeasible call, records spans/timings.
- `PythonPlacer`: sends the request, applies the response, persists, writes the `SlotProposal`,
  and — on any `PlacementClient` failure (timeout, 5xx, connect error, breaker open, contract
  version mismatch, or `BANDIT_SERVICE_URL` unset) — falls back to `FallbackPlacer`.
- `FallbackPlacer`: **not legacy mode** — Python's own degraded-mode driver, the frozen
  pre-#62 TS heuristic (`core/slot.ts`, `core/slot-score.ts`, `core/preference.ts`,
  `core/series-spread.ts`, byte-identical to `bc6636d^`), built on `HeuristicPlacer`. Header
  `FROZEN FALLBACK (ADR-0003): bug fixes only; behaviour changes belong in services/bandit`.
  This is the **only** ranking code left in TS, and only runs when Python is unreachable.

**Degraded mode** (Python down, breaker open, `BANDIT_SERVICE_URL` unset, contract mismatch):

- A free slot is placed by the frozen heuristic. The A/B policy is still rolled and recorded, but the
  proposal has `placementSource = TS_FALLBACK`, `modelProposal = null` and a `degradedReason`
  (`timeout | breaker_open | connect | http_5xx | http_4xx | version | invalid_response | disabled`).
- Create/update/reschedule responses carry `schedulingDegraded: true`.
- No displacement, no accept-conflicts/late. With no free slot before the deadline the pre-flight
  fails `503 SCHEDULER_DEGRADED` (`{ success: false, message, code }`, retryable) before anything is written.
- `infeasiblePolicy` is ignored. Series are all-or-nothing (a member without a slot => 503).
- Known edge: if Python dies between pre-flight and placement, a single `TASK` row can exist
  unplaced when the fallback finds no slot (503). The retry re-creates it.
- **Risk (ADR-0003 phase 6 note):** there is no longer a parallel full TS ranking implementation
  to fall back to if `PythonPlacer`/`FallbackPlacer` itself has an undiscovered bug — only git
  history (`5763a29`) has it. Mitigations: `FallbackPlacer` + `PlacementClient`'s
  breaker/retry/timeout, and the contract fixtures (`packages/shared/contract/place/*.json`).

The global exception filter passes a `HttpException` body's `code` (and `options`) through, so
clients see `409 SCHEDULE_INFEASIBLE` and `503 SCHEDULER_DEGRADED`.

- Metrics: `scheduler.placement_source{source,reason}`, `scheduler.breaker_state` (0 closed / 1 half-open / 2 open),
  `bandit.client.request.duration{operation=place}`.
- Spans: `placement.http`, with `placement.python.{decode,context,predict,scan,displace,total}_ms`.
- `BENCH_TIMING=1`: `Server-Timing` carries `dayload`, `http`, `scan`, `predict`, `db_apply`.
- Contract fixtures: `packages/shared/contract/place/*.json`.

### Delayed reward and the A/B experiment

`docs/adr/0001-linucb-model-design.md` + `docs/scheduler/{reranking,ab-testing}.md`.
`ExperimentService.assignPolicy()` (the only RNG left in the placement path) rolls a 50/50
`primaryPolicy` **and** an independent `PAIRWISE_SAMPLE_RATE` (20%) pairwise-sample draw per
`TASK` create / deadline-change event (and, independently, per series member); Python computes
both policies' picks whenever `computeBoth` is set on the request (primary is LINUCB, or this
event was sampled) and Nest records one `SlotProposal` per placement with both proposals when
sampled, so `POST /sessions/:id/slot-pick` (`docs/scheduler/ab-testing.md` §3) has something to
offer. Applied weights (`wL`, `wP` — adaptive cold/warm blend) come back on the response and
land on `SlotProposal.linucbWeight` / `.preferenceWeight`.

Delayed reward (ADR-0001 §9): the first user `MOVE` of a LinUCB-placed session — including a
`POST /sessions/:id/slot-pick` pick of the alternative, which applies exactly like a drag —
sends a graded penalty (`dragDistanceReward`, `core/reward.ts`:
`-min(1, |dragMin| / 240)`) to that arm's `/update`
(`SchedulingFeedbackService.onFirstMove` → shared `applyDelayedReward`); the `RETAINED` sweep
(`RetainedSessionsService`, also via `applyDelayedReward`) sends `+1`. The returned `(A, b)`
is persisted to `BanditArmState`; the `SessionEvent` links back via `slotProposalId`. The same
first-modification call also stamps `SlotProposal.firstModifiedAt` /
`firstModificationType` / `acceptedWithoutModification` (a `"primary"`/blank slot-pick sets
`acceptedWithoutModification = true` instead). Every part is best-effort — a bandit failure
never breaks session create/update.

## Scheduler architecture

The scheduler places **one `TASK`** (or the members of one `TASK` series) into an empty
15-minute slot and never moves anything else. An existing `TASK` series' sitting count can
also be resized after creation (`PATCH /sessions/:id` with `sessionCount` — grow/shrink/promote
a plain `TASK` into a series, `SeriesService.resizeSessionCount`/`promoteToSeries`) — see Flow
5. All ranking now lives in `services/bandit` (Python, ADR-0003); Nest is split into a **pure
core** (`scheduler/core/*` — calendar/recurrence/preference-write helpers, plus the frozen
heuristic fallback; no Prisma, no `new Date()`, no `Math.random()`) and an **I/O layer**
(`scheduler/io/*` — `PythonPlacer`/`FallbackPlacer`, the one occupancy query, the delayed-reward
writer, and the two crons). `sessions/` talks to `TaskPlacementService` and
`SchedulingFeedbackService`.

### Module map

```mermaid
flowchart LR
  subgraph sessions["sessions/"]
    SS[SessionsService]
  end

  subgraph facade["scheduler/io — facade"]
    TPS[TaskPlacementService\npass-through to PythonPlacer]
    SFS[SchedulingFeedbackService]
    SPS[SlotPickService\nsessions/]
  end

  subgraph placement["scheduler/io — placement"]
    PG[PlacementGateway\nbuilds PlaceRequest]
    PC[PlacementClient\ntimeout/retry/breaker]
    PP[PythonPlacer\napplies + persists + SlotProposal]
    FB[FallbackPlacer\nPython-down degraded driver]
    HP[HeuristicPlacer]
    DL[day-load.ts\nthe only occupancy query]
  end

  subgraph crons["scheduler/io — @Cron"]
    RSS[RetainedSessionsService\nEVERY_30_MINUTES]
    MDS[MatrixDecayService\nEVERY_DAY_AT_3AM]
  end

  subgraph core["scheduler/core — pure"]
    SC[slot-score.ts\nfrozen: slotPreferenceScore + bestFreeSlot]
    SPREAD[series-spread.ts\nfrozen]
    PREF[preference.ts]
    REC[recurrence.ts]
    MD[matrix-decay.ts]
  end

  subgraph py["services/bandit — Python, authoritative"]
    PLACE["POST /v1/place\nheuristic + LinUCB + displacement"]
  end

  EXP[ExperimentService\nprimaryPolicy 50/50 + pairwise sample\n+ SlotProposal write]

  SS --> TPS
  SS --> SFS
  SS --> SPS
  TPS --> PP
  PP --> PG & EXP
  PG --> DL & PC
  PC --> PLACE
  PC -. down/breaker open .-> FB
  FB --> HP
  HP --> DL & SC
  FB --> SPREAD
  SC --> PREF
  DL --> REC
  SFS --> PP
  RSS --> SFS
  MDS --> MD
```

### Flow 1 — create a single `TASK`

```mermaid
sequenceDiagram
  participant C as SessionsController
  participant S as SessionsService
  participant T as TaskPlacementService
  participant P as PythonPlacer
  participant G as PlacementGateway
  participant PC as PlacementClient
  participant PY as services/bandit /v1/place
  participant FB as FallbackPlacer
  C->>S: create(dto)
  S->>S: resolveTagIds + $tx( session.create + CREATE event )
  S->>T: placeOnCreate({ user, task, now })
  T->>P: placeSingle(user, task, "create", now, policy?)
  P->>P: assignPolicy() (primaryPolicy 50/50 + pairwise-sample draw)
  P->>G: buildRequest (day loads, pref matrix, obs count, bandit A/b)
  G->>PC: place(request)
  alt Python healthy
    PC->>PY: POST /v1/place
    PY-->>PC: PlaceResponse (picks, moves, timingsMs)
    opt outcome NEEDS_INFEASIBLE_CONTEXT
      G->>G: load deadline+/-1 day + 30d horizon, retry with infeasible context
    end
    PC-->>P: results
    P->>P: apply moves, session.update scheduledStartTime, recordProposal (placementSource=PYTHON)
  else timeout/5xx/breaker open/disabled
    PC-->>P: failure(reason)
    P->>FB: placeSingle (frozen heuristic)
    alt free slot exists
      FB-->>P: start
      P->>P: session.update, recordProposal (placementSource=TS_FALLBACK, degradedReason)
    else no free slot
      P-->>T: throw SchedulerDegradedException (503)
    end
  end
  P-->>T: PlacementResult
  T-->>S: PlacementResult
  S-->>C: CreateSessionResponse (+ slotProposalId/alternativeSlot/divergent/schedulingDegraded?)
```

A pairwise-sampled event's `alternativeSlot`/`divergent` let the client offer a pick via
`POST /sessions/:id/slot-pick` (`docs/scheduler/ab-testing.md` §3) — `SlotPickService`
(`sessions/`) applies the alternative as an ordinary `MOVE` when chosen (reusing
`SchedulingFeedbackService.onFirstMove`'s reward path unchanged), or just records
"kept" otherwise.

### Flow 2 — create a `TASK` series (`sessionCount > 1`)

```mermaid
sequenceDiagram
  participant S as SessionsService.createTaskSeries
  participant T as TaskPlacementService
  participant P as PythonPlacer
  participant PY as services/bandit /v1/place
  participant FB as FallbackPlacer
  S->>S: $tx( sessionSeries.create + N× session.create + N× CREATE event )
  S->>T: placeSeriesOnCreate({ seriesId, members, deadline })
  T->>P: placeSeries({ members, deadline, trigger: "create" })
  P->>P: assignPolicy() per member
  P->>PY: POST /v1/place (members.length > 1 = one materialized series, sibling ledger server-side)
  alt Python healthy
    PY-->>P: one PlacedMember per member
    P->>P: recordProposal per member (placementSource=PYTHON)
  else degraded
    P->>FB: placeSeries (all-or-nothing frozen loop — seriesDayWindows, siblings, day cap)
    FB-->>P: rows[] (any null start => 503 SCHEDULER_DEGRADED)
  end
  P-->>T: rows[]
  T->>T: $tx( session.update scheduledStartTime for placed rows )
  T-->>S: rows[]
```

### Flow 3 — deadline edit → redistribute

```mermaid
sequenceDiagram
  participant S as SessionsService.update
  participant T as TaskPlacementService
  participant P as PythonPlacer
  S->>S: $tx( applyFieldDiff detects newDeadline → session.update )
  alt standalone TASK
    S->>T: placeOnDeadlineChange({ task, now })
    Note over T: identical to Flow 1, trigger "deadline-change"
  else TASK series member
    S->>T: redistributeSeries({ seriesId, members, newDeadline })
    T->>T: partition past / upcoming;  past → fixedOccupied
    T->>P: placeSeries(upcoming, fixedOccupied, trigger "deadline-change")
    T->>T: $tx( sessionSeries.deadline + session.updateMany deadline + upcoming starts )
  end
```

### Flow 4 — delayed LinUCB reward

```mermaid
sequenceDiagram
  participant S as SessionsService.update / SlotPickService
  participant F as SchedulingFeedbackService
  participant R as RetainedSessionsService (@Cron)
  participant BA as Bandit (/update + BanditArmState)
  Note over S: first user MOVE of a scheduled TASK (a drag, or a slot-pick "alternative")
  S->>S: $tx( MOVE SessionEvent + lastMovedAt );  existing.lastMovedAt == null → firstMove
  S->>F: onFirstMove(userId, sessionId, moveEventId, dragMinutes)
  F->>F: applyDelayedReward(reward = dragDistanceReward(dragMinutes), modificationType = MOVE)
  F->>F: slotProposal.findFirst(primaryPolicy LINUCB, selectedArm != null)
  F->>BA: loadAll → /update(reward) → save → link event
  F->>F: firstModifiedAt still null? stamp firstModifiedAt/firstModificationType/acceptedWithoutModification=false
  Note over R: every 30 min
  R->>R: sweep — elapsed, never-moved USER TASK → RETAINED event (+1)
  R->>F: applyDelayedReward(SESSION_RETAINED_REWARD, modificationType = null)
  F->>BA: same loadAll → /update(+1) → save → link event
```

### Flow 5 — edit-mode `sessionCount` resize/promote

```mermaid
sequenceDiagram
  participant S as SessionUpdateService.update
  participant SR as SeriesService
  participant T as TaskPlacementService
  participant P as PythonPlacer
  Note over S: PATCH /sessions/:id with sessionCount
  alt no existing seriesId AND sessionCount > 1
    S->>SR: promoteToSeries(sessionId, deadline, user)
    SR->>SR: $tx( sessionSeries.create + session.update seriesId/sessionIndex=1/sessionTotal=1 )
  end
  S->>SR: resizeSessionCount(seriesId, targetCount, user, now)
  alt grow (targetCount > memberCount)
    SR->>T: canPlaceSeries({ sessionCount: added })  // pre-flight, added sittings only
    T-->>SR: feasible?
    SR->>SR: $tx( session.updateMany sessionTotal + N× session.create + N× CREATE event )
    SR->>T: placeSeriesOnCreate({ seriesId, members: newMembers, deadline })
    T->>P: placeSeries(trigger "create")
    Note over P: day-load naturally schedules around the already-persisted existing members
    P-->>T: rows[]
    T->>T: $tx( session.update scheduledStartTime for placed rows )
  else shrink (targetCount < memberCount)
    Note over SR: candidates = highest-sessionIndex members;<br/>any already started (scheduledStartTime ≤ now) → reject, write nothing
    SR->>SR: $tx( session.deleteMany + session.updateMany sessionTotal )
  end
  SR-->>S: every member, sessionIndex order
```

### Session reminders

`reminders/RemindersService` (I/O) + `scheduler/core/reminder.ts` (pure: fire time, lead-time
formatting, notification copy — takes `now`, covered by `reminder.spec.ts`).

- Each reminder is a one-shot `SchedulerRegistry.addTimeout` named `reminder:<id>`. Timers are
  in-memory, so `sweep()` runs on `OnApplicationBootstrap` and every 5 min (`@Cron`), arming only
  reminders firing within 24 h (`ARM_HORIZON_MS`) — this is the `setTimeout` 32-bit-overflow
  guard — and cancelling timers whose reminder vanished. `SessionsService` calls `syncUser()`
  after every create / update / slot-pick / delete so a move or delete re-arms/cancels at once.
- On fire the service re-reads the DB and only delivers if the plan is unchanged (a stale timer
  re-arms instead), then claims the occurrence via `firedForStart` (idempotent).
- Fire policy: `startsAt - remindBeforeMinutes`; if that is already past but the session has not
  started, fire now (title shows the real time left); a session that already started is skipped.
  A session moved to a new start fires again for the new start.
- Delivery reuses `NotificationsService.create` (`eventName: "reminder.fired"`, title like
  "Standup starts in 1 hour", content "Standup starts at Sat, 20 Sep, 14:00 at Room A1.") and emits
  `NEW_SESSION`, so it reaches the SSE stream and `PushService` unchanged.
- Ingested lectures/assignments/exams get the same 60-minute default (`MaterializerService.create`
  inserts the `SessionReminder`; the next sweep arms it) with type-specific copy — "Exam in 1 hour:
  <title>", "Due in 1 hour: <title>", "Class in 1 hour: <title>". Sessions ingested before this
  change have no reminder.
- Recurring fixed series: reminders live on the representative row and fire once per upcoming
  occurrence (exdates respected). Notification `sessionId` is the representative row id.
- Limitations: single-process timers (multi-instance would double-arm; the `firedForStart` claim
  keeps sends idempotent); a `TASK` series grown later copies the existing sittings' reminders.

### Slot scoring — the frozen fallback's overlap-weighted preference score

`slotPreferenceScore` (`core/slot-score.ts`, **frozen** — ADR-0003, `FallbackPlacer` only)
scores a concrete interval by how much of it falls in each local **clock-hour block** it
touches, weighted by that block's preference value:

```text
score(slot) = Σ over each hour block [h, h+1) the slot touches:
                overlapFraction(slot ∩ [h, h+1)) · pref[weekday(h)][h]
```

A slot that only partially covers an hour contributes that hour fractionally — e.g. a
**09:15–11:00** slot scores `0.75·pref[..][9] + 1.0·pref[..][10]`. `[start, end)` is
half-open, so the block starting exactly at `end` is never scored. A midnight-spanning slot
is split at local midnight and each side scored against its own day's weekday row. The
matrix is **168 signed floats** — 7 ISO weekdays × 24 one-hour buckets, row-major
(`matrixIndex(isoWeekday, hour) = (isoWeekday−1)·24 + hour`). `bestFreeSlot` picks the
highest-scoring free slot in a window (plus `stabilityScore`, a light nudge toward the
previous manually-set start).

LinUCB slot-first scoring (context vector, arm scoring, adaptive weights, tie-break order) is
Python's — `services/bandit/src/core/linucb_best_slot.py` and friends. It is **not**
golden-fixture-tested against TS any more (ADR-0003 phase 6): there is no TS implementation to
compare against. See `docs/scheduler/heuristic.md` and `services/bandit/README.md`.

### Displacement and sync conflicts (issue #62 B / D)

Displacement planning (EDF repack) and the two infeasible fallbacks
(`ACCEPT_CONFLICTS`/`ACCEPT_LATE_DEADLINE`) are Python's
(`services/bandit/src/core/displacement.py`), reached via the two-phase `/v1/place` infeasible
flow (ADR-0003 §3.3). Nest's role is applying the response:

| Concern                                                           | File                                            |
| ----------------------------------------------------------------- | ----------------------------------------------- |
| persist moves as `SYSTEM_MOVE`s (`applyMoves`/`isFlexible`)       | `scheduler/io/displacement.service.ts`          |
| pre-flight (400 / 409) + delegate to `PythonPlacer`               | `scheduler/io/task-placement.service.ts`        |
| pure conflict detection                                           | `scheduler/core/sync-conflicts.ts`              |
| per-source sync-conflict notification                             | `ingestion/sync-conflicts.service.ts`           |
| "reschedule all" (`POST /notifications/:id/reschedule-conflicts`) | `scheduler/io/conflict-reschedule.service.ts`   |
| batched day loads (`loadDayLoads`, 2 queries for N days)          | `scheduler/io/day-load.ts`                      |

Golden fixtures, narrowed to the frozen fallback (ADR-0003 phase 6):
`pnpm --filter backend golden:export` writes `test/golden/scheduler-core.golden.json`
(`slotPreferenceScore`, `stabilityScore`, `bestFreeSlot`, `findConflictingTaskIds` —
`golden-fixtures.spec.ts` fails on drift); `services/bandit/tests/test_golden_ts.py` asserts
Python's frozen-heuristic port matches. Rule: a fallback bug fix needs spec + golden update +
`test_golden_ts.py` staying green — behaviour changes never happen here, they go in
`services/bandit`.

### Series bounded window

For a `sessionCount > 1` `TASK` series, `seriesDayWindows(daySpan, N)` (`core/series-spread.ts`,
**frozen**, used by both `FallbackPlacer` and — ported — Python) partitions the `daySpan + 1`
days into `N` contiguous, **non-overlapping** buckets — no two members' windows can ever touch:

```text
totalDays = daySpan + 1
base      = floor(totalDays / N)             // days per member, at minimum
remainder = totalDays % N                    // the LAST `remainder` members get one extra day
```

Member `i`'s window is exactly its bucket: `base` days each, except the last `remainder`
members get `base + 1` (so the series still starts on day 0 and the slack lands closest to the
deadline). `daySpan` = whole days from the next 15-min boundary to the deadline day, capped at
`MAX_SCAN_DAYS − 1`. Already-placed siblings are fed forward as hard blocks so members never
overlap, and a day already holding `MAX_SERIES_PER_DAY` (1) sitting of this series is skipped.
A member that finds nowhere comes back unplaced without blocking the rest. `N` can exceed
`totalDays` (more sessions than days) — buckets then collapse toward the tail, several members
sharing one day's window; that's an unavoidable overlap the day cap and the series pre-flight
(`TaskPlacementService.canPlaceSeries`) keep safe, not this partition.

### Trace it in the source

| Concept                                                                             | File                                          |
| ----------------------------------------------------------------------------------- | --------------------------------------------- |
| preference matrix helpers (`matrixIndex`, default/effective, `preferenceScoreAt`)   | `scheduler/core/preference.ts`                |
| **frozen fallback**: overlap-weighted slot score + best-free-slot search            | `scheduler/core/slot-score.ts`                |
| preference-matrix reinforcement (`reinforcePreferenceCell`)                         | `scheduler/core/preference.ts`                |
| **frozen fallback**: series even spread + non-overlapping day buckets               | `scheduler/core/series-spread.ts`             |
| rrule expansion + occurrence-id helpers                                             | `scheduler/core/recurrence.ts`                |
| exponential preference-matrix decay                                                 | `scheduler/core/matrix-decay.ts`              |
| pure delayed-reward math (`dragDistanceReward`)                                     | `scheduler/core/reward.ts`                    |
| pure conflict detection                                                             | `scheduler/core/sync-conflicts.ts`            |
| one day's occupied intervals + workload (the only occupancy query)                  | `scheduler/io/day-load.ts`                    |
| **frozen fallback driver** — `placeSingle` / `placeSeries` on `HeuristicPlacer`      | `scheduler/io/heuristic-placer.service.ts`, `scheduler/io/fallback-placer.service.ts` |
| the thin pass-through `sessions/` calls (arithmetic guard + persist)                | `scheduler/io/task-placement.service.ts`      |
| gather -> `POST /v1/place` -> apply -> persist -> `SlotProposal`; degraded fallback  | `scheduler/io/python-placer.service.ts`       |
| `PlaceRequest` builder + two-phase infeasible call                                  | `scheduler/io/placement-gateway.service.ts`   |
| timeout/retry/circuit-breaker HTTP client for `/v1/place`                          | `scheduler/io/placement-client.service.ts`, `scheduler/io/circuit-breaker.ts` |
| `TASK` series lifecycle — create, deadline redistribute, edit-mode `sessionCount` resize/promote | `sessions/series.service.ts`       |
| delayed reward (first-`MOVE` + `RETAINED`) + `SlotProposal` acceptance columns       | `scheduler/io/scheduling-feedback.service.ts` |
| `RETAINED` sweep — finds + marks elapsed sessions, delegates reward to the above     | `scheduler/io/retained-sessions.service.ts`   |
| `POST /sessions/:id/slot-pick`                                                       | `sessions/slot-pick.service.ts`               |
| nightly matrix decay cron                                                           | `scheduler/io/matrix-decay.service.ts`        |
| `primaryPolicy` 50/50 + pairwise-sample draw + `SlotProposal` write                  | `experiments/experiment.service.ts`           |
| tuning constants (`MAX_SCAN_DAYS`, `MAX_SERIES_PER_DAY`, `BANDIT_*`, `PAIRWISE_SAMPLE_RATE`, reward scales — Python's own copies own ranking behaviour, these are the fallback's) | `scheduler/constants.ts` |
| Python's authoritative ranking core (heuristic, LinUCB, series, displacement)        | `services/bandit/src/core/*`                  |

## Observability

Traces, metrics and logs (issue #53). App-side instrumentation lives in
`src/observability/` + `src/tracing.ts` (preloaded via `node --require ./dist/tracing.js`
in `start:prod`); it is a no-op unless `OTEL_SDK_DISABLED=false`. All of it stays in
`scheduler/io/*` and above — the `core/*` pure functions take no tracer (CLAUDE.md #2).

| Signal      | Emitted by                                                              | Path to Grafana                                            |
| ----------- | --------------------------------------------------------------------- | --------------------------------------------------------- |
| **Traces**  | auto-instrumentations (http/express/nest/undici/pg/redis) + `withSpan()` seams (`otel.ts`) + Prisma | OTLP → OTel Collector → **Tempo**                          |
| **Metrics** | OTel Meter instruments in `observability/metrics.ts` (HTTP RED, outbound RED, ingestion, scheduler/bandit, push, SSE) | OTLP → Collector `prometheus` exporter ← **Prometheus** scrape |
| **Logs**    | `nestjs-pino` JSON (one line, `message` key, `traceId`/`correlationId`/`userId` mixin) | container stdout → **Alloy** → **Loki**                    |

The Grafana stack (Collector, Tempo, Loki, Alloy, Prometheus, node-exporter, cAdvisor,
Grafana) is defined in **`compose.prod.yml`** and, for local use, the standalone
**`compose.observability.yml`**. Config + provisioned datasources + three dashboards
(*API Overview*, *Scheduler & Bandit*, *Ingestion & Watchers*) live in
[`observability/`](observability/README.md) — start there.

```bash
# Standalone stack, then run the API locally against it:
docker compose -f compose.observability.yml up -d          # Grafana → :3000
OTEL_SDK_DISABLED=false OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 pnpm start:prod
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
