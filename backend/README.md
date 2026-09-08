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
│   ├── sessions/               # session CRUD; create/deadline-edit place just the one
│   │   │                       #   TASK (or a series) — nothing else moves (see below)
│   │   ├── session-mapper.ts    # PURE — row → wire DTO / event snapshot
│   │   ├── session-events.ts    # PURE — CREATE / MOVE SessionEvent builders
│   │   ├── prisma-error.ts      # P2025 → 404 / else 500 mapper for update/remove
│   │   ├── types/session-row.ts # SessionRow (tags + series) + WITH_TAGS_AND_SERIES
│   │   └── ...
│   ├── scheduler/              # places ONE TASK / series — see "Scheduler architecture" below
│   │   ├── core/                # PURE algorithm — no Prisma, no clock, no randomness
│   │   │   ├── preference.ts        # matrixIndex / default+effective matrix / preferenceScoreAt
│   │   │   ├── slot-score.ts        # slotPreferenceScore (overlap-weighted) + bestFreeSlot
│   │   │   ├── linucb-slot-score.ts # Σ_arm overlapRate·predicted + slotPreferenceScore  (cold-start blend)
│   │   │   ├── context-vector.ts    # buildContextVector() — the LinUCB d=46 feature vector
│   │   │   ├── arms.ts              # 5 time-of-day arm bands, armOfMinute / overlapRate
│   │   │   ├── series-spread.ts     # seriesDayWindows — non-overlapping per-member day buckets
│   │   │   ├── normalize.ts         # minMaxSigned + feature divisors
│   │   │   ├── recurrence.ts        # rrule expand / occurrence-id helpers
│   │   │   ├── matrix-decay.ts      # exponential preference-matrix decay
│   │   │   ├── slot.ts              # 15-min slot grid math, isoWeekday, overlap check
│   │   │   └── horizon.ts           # calendar math (period ceilings, calendar minutes)
│   │   ├── types/               # placement.types.ts, day-load.types.ts, context-vector.types.ts
│   │   └── io/                  # the ONLY Prisma / bandit-HTTP layer
│   │       ├── day-load.ts              # one day's occupied intervals + workload
│   │       ├── heuristic-placer.service.ts # HeuristicPlacer — placeTask / placeInWindow
│   │       ├── bandit-placer.service.ts    # BanditPlacer — per-day /predict + slot pick
│   │       ├── series-placer.service.ts    # SeriesPlacer — per-member bounded 50/50
│   │       ├── task-placement.service.ts   # TaskPlacementService — the facade sessions/ calls
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
| `preferenceMatrix`          | float[]    | flat **168** signed floats — 7 ISO weekdays × 24 one-hour buckets, row-major (`matrixIndex(isoWeekday, hour) = (isoWeekday−1)·24 + hour`). Positive = preferred, negative = disliked, 0 = neutral. **Read by the engine** — both `slotPreferenceScore` (Policy A) and the LinUCB context vector — and eroded nightly by the decay cron. Seeded lazily from the cold-start default. |
| `preferenceMatrixDecayedAt` | DateTime?  | When the daily decay cron last decayed `preferenceMatrix`; null until the first pass                                                                                                                                                                                                                                                                                               |
| `onboardingComplete`        | bool       | `UsersService.create()` always writes `true`; there is no onboarding flow. Unused by any endpoint.                                                                                                                                                                                                                                                                                 |

`workStart`/`workEnd`/`workDays` (a per-user working-hours window/working-days set) were
**dropped with no replacement**. The scheduler now places tasks across the full
24h/`DAILY_HORIZON` (1440 min) grid, every calendar day — see [Scheduler architecture](#scheduler-architecture).

### `Session`

| Field                           | Type            | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                            | uuid            | PK                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `title`, `note`                 | string          | `note` is rich text (TipTap)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `location`                      | string?         | free-text room / building, optional. Set directly by the client; the DLU watchers write the upstream room here (portal `PhongThi`/`RoomID`, Moodle event `location`). Never read by the scheduler.                                                                                                                                                                                                                                                                                                          |
| `durationMinutes`               | int             | **always a positive multiple of 15**                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `deadline`                      | DateTime?       | set for `TASK`; `null` for the fixed types. Ordering key for placement.                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `tags`                          | `Tag[]`         | implicit many-to-many with `Tag` (per-user labels)                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `type`                          | `SessionType`   | `TASK` \| `ASSIGNMENT` \| `EXAM` \| `LECTURE` \| `DND`. `TASK` is engine-placed; the rest are user-pinned.                                                                                                                                                                                                                                                                                                                                                                                                  |
| `source`                        | `SessionSource` | `USER` \| `LMS` \| `PORTAL`, default `USER`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `conflict`                      | bool            | true when the session overlaps another's interval, or has no valid placement (`scheduledStartTime` null). An overlap is an accepted state — a direct drag/resize can knowingly create one; neither session is auto-relocated.                                                                                                                                                                                                                                                                               |
| `scheduledStartTime`            | DateTime?       | the engine's placement for a `TASK`; the client-supplied instant for a fixed / `DND` session; `null` while unplaced.                                                                                                                                                                                                                                                                                                                                                                                        |
| `lastMovedAt` / `retainedAt`    | DateTime?       | move-or-keep bookkeeping (ADR-0002 §2.1). `lastMovedAt == null` = never moved; the half-hourly `RETAINED` sweep stamps `retainedAt`.                                                                                                                                                                                                                                                                                                                                                                        |
| `rrule`                         | —               | on `SessionSeries`, not `Session` — the bare recurrence rule for a recurring fixed series (`null` for a `TASK` series). `exdates` holds individually-deleted occurrences.                                                                                                                                                                                                                                                                                                                                   |
| `userId`                        | uuid            | FK → `User`, `onDelete: Cascade`                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `seriesId`                      | uuid?           | FK → `SessionSeries`, `onDelete: Cascade`. Set for a recurring fixed-type (`DND`/`ASSIGNMENT`/`EXAM`/`LECTURE`) representative and for every session of a `POST /sessions` `sessionCount > 1` `TASK` series.                                                                                                                                                                                                                                                                                                |
| `sessionIndex` / `sessionTotal` | int?            | 1-based position / total session count within a `TASK` series (null otherwise). Denormalized for cheap per-row rendering.                                                                                                                                                                                                                                                                                                                                                                                   |
| `externalKey`                   | string?         | Stable identity of the upstream DLU item this session mirrors; null for user-created sessions. `"lms:assign:<instance>"` \| `"lms:quiz:<instance>"` \| `"portal:exam:<Examination>"` \| `"portal:meeting:<WeekScheduleID>"`. The LMS half keys on the activity **`instance`**, never the calendar event id. Unique per `[userId, externalKey]` — this is the ingestion idempotency guard: the watchers re-fetch the same window every cron tick and upsert on it, so a re-run can't duplicate the calendar. |

Indexes: `[userId, deadline]`, `[userId, scheduledStartTime]`,
`[userId, seriesId, createdAt asc]`; unique `[userId, externalKey]`.

### `SessionEvent` (append-only audit trail — the ML fuel)

| Field                         | Type               | Notes                                                         |
| ----------------------------- | ------------------ | ------------------------------------------------------------- |
| `id`                          | BigInt             | autoincrement (serialized as decimal string over the wire)    |
| `eventType`                   | `SessionEventType` | `CREATE` \| `MOVE` \| `RESIZE` \| `RETAINED`                  |
| `oldSnapshot` / `newSnapshot` | Json               | `{ scheduledStartTime, durationMinutes, tags }`               |
| `rewardScore`                 | float              | Phase-3 reward signal (default 1.0)                           |
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

On task create/update the backend resolves an incoming array of tag **names**:
unknown names are upserted (per user) and all are connected to the occurrence(s),
atomically inside the task transaction. The wire format keeps `Session.tags` as a
`string[]` of names — the `Tag` table is a backend detail.

### `File`

`id`, `originalName`, `filename`, `path`, `mimetype`, `size`, `userId` (cascade).

### DLU ingestion tables

| Table                               | Purpose                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `LmsCourse`                         | A Moodle course from the LMS calendar response's `course` block. Deduped on `lmsCourseId` (Moodle `course.id`).                                                                                                                                                                                                                      |
| `PortalSection`                     | One student-portal course section — curriculum unit × term × group × teacher × room. Deduped on `scheduleStudyUnitId`; indexed `[yearStudy, termId]`, the access path for a whole-term refresh.                                                                                                                                      |
| `LmsSyncJob` / `LmsSyncJobItem`     | Per-run tracking for the LMS watcher (`PENDING → PROCESSING → COMPLETED \| FAILED`), one item per upstream request with `url`, `attempt`, `statusCode`, `responseBody`. The raw body is kept so a bad parse stays diagnosable.                                                                                                       |
| `PortalAPIJob` / `PortalAPIJobItem` | The same shape for the portal poller — `LmsSyncJobItem` was widened to match it field-for-field.                                                                                                                                                                                                                                     |
| `Notification`                      | Raised by the materializer for a new / changed / removed ingested item. `kind` (`NEW`\|`CHANGE`\|`DROP`) drives the inbox badge; `eventEndsAt` is the linked session's fixed end instant (null for grouped rows and drops). `sessionId` points at the session (the earliest meeting for a grouped timetable row; `null` once that session is deleted). Topics `ASSIGNMENT` \| `EXAM` \| `TIMETABLE` \| `REMINDER`; a whole term of lectures is one `TIMETABLE` row, not one per meeting. |

**LMS and portal course identity are deliberately independent.** `LmsCourse` and
`PortalSection` describe the same real-world class but share no identifier and are never
joined: there is no correlation table and no foreign key between them. The two systems
name courses differently, so any mapping would be a fuzzy string match — and nothing in
the ingestion path needs it, since an LMS item is scheduled from LMS data alone and a
timetable meeting from portal data alone.

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
- **Never clobbers a student's edit.** If the row has `lastMovedAt != null`, an upstream
  change does not overwrite it — the session is left exactly as they left it and a
  `TIMETABLE` notification says the two now disagree (#30's open question, resolved in the
  student's favour). That warning is deduplicated on its content, which embeds the upstream
  instant, because unlike a normal change this disagreement never resolves itself; a
  _further_ upstream move still speaks up.
- **Follows** an upstream change on a session the student never touched — without writing a
  `SessionEvent` and without setting `lastMovedAt`. Both mean "the user did this", and
  fabricating one would feed the LinUCB reward signal a move nobody made.
- **A quiet re-run is quiet**: notifications are raised only for genuinely new, changed or
  removed items.
- **Every row is categorised and time-stamped.** `raise()` stamps a `kind` (`NEW` for a
  fresh calendar item, `CHANGE` for an upstream edit, `DROP` for a removal — the inbox
  badge) and, for a per-item assignment/exam/lecture, an `eventEndsAt` (its
  `scheduledStartTime + durationMinutes`, the "due"/"at" time the inbox shows). Grouped and
  dropped rows leave `eventEndsAt` null. User-facing copy says **"semester 1/2/3"**
  (`termLabel`), never the portal's `HK0x`.
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
  set has been dropped upstream — a cancelled class, a withdrawn exam, a deleted assignment
  — and is deleted (no `SessionEvent`; the `Notification` FK is `SetNull`). The removal
  notification groups exactly like a creation does for lectures, one-per-item for
  assignments/exams. A session the student had hand-moved is kept (invariant #2) with a
  single deduplicated "removed at DLU" warning instead.

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

| Method | Path                          | Purpose                                                                                                                                            |
| ------ | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/users/me`                   | profile                                                                                                                                            |
| PATCH  | `/users/update/basic-info`    | update name/email                                                                                                                                  |
| GET    | `/users/me/preference-matrix` | the current user's flat 168-float signed preference matrix for the Insights heatmap (`PreferenceMatrixResponse`; cold-start → all-zero). Read-only |

There is no onboarding endpoint and no preferences-update endpoint. Onboarding was removed
entirely (no flow, no `onboardingComplete` gate — every new user is created with
`onboardingComplete: true`). `timezone` is captured once at OTP signup (`x-timezone` header
on `POST /auth/otp/verify` → `AuthService.createUserIfNotExists` → `UsersService.create()`)
and is otherwise fixed — there is no later edit path.

The `if (!user)` branch of `AuthService.createUserIfNotExists` (a brand-new signup, fires
once per account) also seeds 4 default daily-recurring `DND` blocks onto the new user's
calendar via `SessionsService.create()` — the same `DND` + `rrule` path a user's own "create
a recurring DND" action goes through — so the calendar isn't empty on day one and the
scheduler already avoids these times: Breakfast 06:00–07:00, Lunch & rest 11:00–13:00,
Evening chill & dinner 17:00–19:00, and Sleep 22:00–06:00 (`rrule: "FREQ=DAILY"`, each
anchored to "today" in the user's own timezone; Sleep intentionally crosses midnight).
Seeding is best-effort — each block is created independently and any failure is logged
(`Logger.warn`) and swallowed, never blocking or failing the OTP-verify response.

### Sessions (`/sessions`)

Controller is `@Controller("sessions")`; there is no `/tasks` route. Drag, resize and
reschedule are all the one `PATCH /sessions/:id` — a plain field diff, recorded server-side
as a `MOVE` signal. There is no completion/status, no `/reschedule`, `/resize`, `/optimize`
or `/undo` route.

| Method | Path                                         | Purpose                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------ | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/sessions`                                  | Create a session (`CreateSessionDto` — the `CreateSessionInput` union). A `TASK` is placed into its single best free slot (`TaskPlacementService`), or, with `sessionCount > 1`, a materialized series spread across `now … deadline` (`sessions[]` in the response). A fixed / `DND` session is written at the client-supplied `scheduledStartTime`, with an optional `rrule`. Never displaces another session. |
| GET    | `/sessions?view=&date=`                      | List within the view window (`day` / `week` / `month`) + unplaced sessions. DB-level range filter — never fetches the whole history. Recurring fixed series are fanned out into per-occurrence virtual rows.                                                                                                                                                                                                     |
| GET    | `/sessions/suggestions?q=&limit=`            | Title autocomplete — the user's existing sessions, newest first, deduped by title (case-insensitive), optional `q` substring. `limit` 1–50, default 10. Declared before `/sessions/:id`. Read-only.                                                                                                                                                                                                              |
| GET    | `/sessions/deadline-options?anchor=`         | The six deadline quick-chip instants (Today / Tomorrow / This week / Next week / This month / No rush), from `horizon.ts` ceiling math relative to `anchor`.                                                                                                                                                                                                                                                     |
| GET    | `/sessions/:id`                              | Session detail. For a recurring occurrence, `:id` is `"<seriesId>::<startISO>"` (URL-encoded).                                                                                                                                                                                                                                                                                                                   |
| PATCH  | `/sessions/:id`                              | `UpdateSessionDto` — metadata (title/note/location/tags/deadline), `scheduledStartTime` / `durationMinutes` (drag / resize), `rrule`. `scope` (`occurrence` / `following` / `series`) + `skipConflicting` narrow a change to a series member; a recurring-occurrence PATCH re-anchors the series' time-of-day. Response may carry `sessions[]` (series redistribution) and `skippedSessionIds`.                  |
| DELETE | `/sessions/:id`                              | Delete one session; on an occurrence id, add that date to the series' `exdates`. Frees the slot. Returns `{ id }`.                                                                                                                                                                                                                                                                                               |
| DELETE | `/sessions/series/:seriesId`                 | Delete the whole series (every occurrence/sitting + the series row).                                                                                                                                                                                                                                                                                                                                             |
| DELETE | `/sessions/series/:seriesId/truncate?from=`  | Recurring series only — pull the rrule's `UNTIL` back to just before `from` ("this and following").                                                                                                                                                                                                                                                                                                              |
| DELETE | `/sessions/series/:seriesId/from/:sessionId` | Materialized `TASK` series only — delete that sitting and every later one by `sessionIndex`; earlier sittings kept.                                                                                                                                                                                                                                                                                              |

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
| POST   | `/integrations`                | Connect a provider. Body `{ provider: "LMS" \| "PORTAL", username, password }`. Probes a live login first (`400` if rejected, `503` if DLU is unreachable, no write either way), then encrypts and upserts the row.                                                                                                                                                                                                                            |
| GET    | `/integrations`                | `{ integrations: [{ provider, connected, lastVerifiedAt, lastSyncedAt, lastSyncStatus }] }` — one entry per provider. The last pair is derived from the newest job row for that integration, not a denormalized column.                                                                                                                                                                                                                        |
| PATCH  | `/integrations/:provider`      | Update a provider's credentials. Body `{ username?, password? }`. Probes a live login first (`400` if rejected, `503` if DLU is unreachable, no write either way), then encrypts and upserts the row.                                                                                                                                                                                                                                          |
| DELETE | `/integrations/:provider`      | Disconnect. Idempotent; keeps the `UserEncryptionKey`.                                                                                                                                                                                                                                                                                                                                                                                         |
| POST   | `/integrations/:provider/sync` | Run this student's watchers **now** — the manual counterpart to the crons (`LMS` runs one watcher; `PORTAL` runs the timetable and exam watchers in turn). `404` if the provider isn't connected. Awaits the run, then answers with that provider's `IntegrationStatus`, so `lastSyncedAt` / `lastSyncStatus` describe the sync just performed. Deliberately **not** a per-run counts payload: those counts live in the job rows and the logs. |

### Notifications (`/notifications`)

The ingestion inbox. Rows are written by the watchers' materializer, never by a client, so
there is no create route. `CookieAuthGuard` + `@CurrentUser()`, own rows only; types in
`@zenflow/shared` (`NotificationTopic`, `NotificationKind`, `NotificationDto`,
`NotificationsListResponse`). Every row carries a `kind` (`NEW` / `CHANGE` / `DROP`, the
inbox badge) and, for a per-item assignment/exam/lecture, an `eventEndsAt` (the linked
session's fixed end instant — its "due"/"at" time); grouped and dropped rows leave it null.

| Method | Path                              | Purpose                                                                                                                                                                                                                                                                     |
| ------ | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/notifications?limit=&offset=`   | One page, **newest first** (`sentAt` only — read state never moves a row, so marking the page read on open can't reshuffle it or drop rows past `limit`). Unread shows via row styling + `unreadCount`, which counts the whole inbox, not the page — it drives the badge, which must not shrink as the user pages. |
| PATCH  | `/notifications/:id/read`         | Stamp `readAt`. Idempotent, and keeps the first instant. `404` if the row isn't the caller's.                                                                                                                                                                               |
| PATCH  | `/notifications/:id/action-taken` | Stamp `actionTakenAt` — acting on a notification is not the same as seeing it. Same idempotency and `404`.                                                                                                                                                                  |
| DELETE | `/notifications/:id`              | Dismiss — a hard delete scoped to the caller (`404`, never `403`, on someone else's or a stale id). No `dismissedAt` stamp: a dismissed row carries no signal worth keeping. Web calls it from the hover ✕; mobile from swipe-to-dismiss.                                    |

`GET /notifications` formally belongs to #31; it lives here now because nothing else makes
the rows the watchers write reachable. Confirm semantics stay in #31.

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
bandit service (`services/bandit/`). When unset, LinUCB scheduling is disabled and every
scheduling event falls back to the heuristic.

## LinUCB scheduling (A/B experiment)

`docs/adr/0001-linucb-model-design.md` + `docs/scheduler/{reranking,ab-testing}.md`, and
the [Scheduler architecture](#scheduler-architecture) walkthrough below. On `POST /sessions`
(a single `TASK`) and a `TASK` deadline change, `TaskPlacementService` places the one
session via `HeuristicPlacer.placeTask`, then `ExperimentService.assignPolicy()` picks a
50/50 `primaryPolicy`:

- **HEURISTIC** — keep the heuristic placement; record a `SlotProposal`.
- **LINUCB** — `BanditPlacer.placeTask()` builds one `d=46` context vector per candidate day
  (`core/context-vector.ts`), calls the bandit service `/predict` once, scores the empty
  hard-constraint-feasible 15-min slots by
  `Σ_arm overlapRate·predicted + slotPreferenceScore` (`core/linucb-slot-score.ts` — the
  preference term is a cold-start blend so a slot ranks sensibly before any arm has learned),
  and picks the earliest top slot. A slot may run past local midnight up to the deadline. If
  it produces a pick, THIS session's `scheduledStartTime` is overridden (no other session
  moves); otherwise the heuristic placement stands. Either way a `SlotProposal` is recorded
  with `featureVector` + `selectedArm`.

A `sessionCount > 1` series is placed by `SeriesPlacer`: each member gets an even-spread
target day, then goes through the **same per-member 50/50 heuristic-or-LinUCB pick**, with
its candidate-day window clamped to `± max(1, floor(X/N))` days around the target (`X` =
whole days to the deadline, `N` = member count). Members never overlap, at most
`MAX_SERIES_PER_DAY` (1) per calendar day, and one `SlotProposal` is recorded per member. A
deadline edit re-runs the same path over the still-upcoming sittings.

Delayed reward (ADR-0001 §9): the first user `MOVE` of a LinUCB-placed session sends a
graded penalty (`-min(1, |dragMin| / 240)`) to that arm's `/update` (`SchedulingFeedbackService`);
the `RETAINED` sweep sends `+1`. The returned `(A, b)` is persisted to `BanditArmState`; the
`SessionEvent` links back via `slotProposalId`. Every part is best-effort — a bandit failure
never breaks session create/update.

## Scheduler architecture

The scheduler places **one `TASK`** (or the members of one `TASK` series) into an empty
15-minute slot and never moves anything else. It is split into a **pure core**
(`scheduler/core/*` — scoring, ranking, arm bands, series math, the LinUCB feature vector,
recurrence, decay; no Prisma, no `new Date()`, no `Math.random()`) and an **I/O layer**
(`scheduler/io/*` — the placers, the one occupancy query, the A/B facade, the delayed-reward
writer, and the two crons). `sessions/` talks to exactly two of them.

### Module map

```mermaid
flowchart LR
  subgraph sessions["sessions/"]
    SS[SessionsService]
  end

  subgraph facade["scheduler/io — facade"]
    TPS[TaskPlacementService]
    SFS[SchedulingFeedbackService]
  end

  subgraph placers["scheduler/io — placers"]
    HP[HeuristicPlacer]
    BP[BanditPlacer]
    SP[SeriesPlacer]
    DL[day-load.ts\nthe only occupancy query]
  end

  subgraph crons["scheduler/io — @Cron"]
    RSS[RetainedSessionsService\nEVERY_30_MINUTES]
    MDS[MatrixDecayService\nEVERY_DAY_AT_3AM]
  end

  subgraph core["scheduler/core — pure"]
    SC[slot-score.ts\nslotPreferenceScore + bestFreeSlot]
    LSS[linucb-slot-score.ts]
    CV[context-vector.ts]
    ARMS[arms.ts]
    SPREAD[series-spread.ts]
    PREF[preference.ts]
    REC[recurrence.ts]
    MD[matrix-decay.ts]
  end

  EXP[ExperimentService\n50/50 assign + SlotProposal]
  BANDIT[BanditService + BanditArmStateRepository\n→ services/bandit /predict /update]

  SS --> TPS
  SS --> SFS
  TPS --> HP & BP & SP
  TPS --> EXP
  SP --> HP & BP & EXP
  HP --> DL & SC
  BP --> DL & CV & LSS & BANDIT
  LSS --> ARMS & SC
  SP --> SPREAD
  SC --> PREF
  DL --> REC
  SFS --> BANDIT
  RSS --> BANDIT
  MDS --> MD
```

### Flow 1 — create a single `TASK`

```mermaid
sequenceDiagram
  participant C as SessionsController
  participant S as SessionsService
  participant T as TaskPlacementService
  participant H as HeuristicPlacer
  participant E as ExperimentService
  participant B as BanditPlacer
  C->>S: create(dto)
  S->>S: resolveTagIds + $tx( session.create + CREATE event )
  S->>T: placeOnCreate({ user, task, now })
  T->>H: placeTask → placeInWindow (per day: loadDayLoad + bestFreeSlot)
  H-->>T: heuristic start (or null)
  T->>T: session.update scheduledStartTime
  T->>E: assignPolicy()  (50/50)
  alt LINUCB
    T->>B: placeTask (per day: loadDayLoad + buildContextVector → /predict → linucbSlotScore)
    B-->>T: BanditPick (or null → heuristic stands)
    T->>T: session.update scheduledStartTime (override)
    T->>E: recordProposal(LINUCB, featureVector, selectedArm)
  else HEURISTIC
    T->>E: recordProposal(heuristic)
  end
  T-->>S: { scheduledStartTime, appliedPolicy }
  S-->>C: toSessionDto(...)
```

### Flow 2 — create a `TASK` series (`sessionCount > 1`)

```mermaid
sequenceDiagram
  participant S as SessionsService.createTaskSeries
  participant T as TaskPlacementService
  participant SP as SeriesPlacer
  participant E as ExperimentService
  participant H as HeuristicPlacer
  participant B as BanditPlacer
  S->>S: $tx( sessionSeries.create + N× session.create + N× CREATE event )
  S->>T: placeSeriesOnCreate({ seriesId, members, deadline })
  T->>SP: placeSeries(trigger "create")
  Note over SP: seriesDayWindows → per member: its own non-overlapping day bucket
  loop each member
    SP->>E: assignPolicy()
    SP->>H: placeInWindow(window, extraOccupied = siblings, skipDay = ≤3/day cap)
    opt LINUCB
      SP->>B: placeInWindow(window, ...)
    end
    SP->>SP: accumulate sibling interval
    SP->>E: recordProposal(...)   // one per member
  end
  SP-->>T: rows[]
  T->>T: $tx( session.update scheduledStartTime for placed rows )
  T-->>S: rows[]
```

### Flow 3 — deadline edit → redistribute

```mermaid
sequenceDiagram
  participant S as SessionsService.update
  participant T as TaskPlacementService
  participant SP as SeriesPlacer
  S->>S: $tx( applyFieldDiff detects newDeadline → session.update )
  alt standalone TASK
    S->>T: placeOnDeadlineChange({ task, now })
    Note over T: identical to Flow 1 step 2, trigger "deadline-change"
  else TASK series member
    S->>T: redistributeSeries({ seriesId, members, newDeadline })
    T->>T: partition past / upcoming;  past → fixedOccupied
    T->>SP: placeSeries(upcoming, fixedOccupied, trigger "deadline-change")
    T->>T: $tx( sessionSeries.deadline + session.updateMany deadline + upcoming starts )
  end
```

### Flow 4 — delayed LinUCB reward

```mermaid
sequenceDiagram
  participant S as SessionsService.update
  participant F as SchedulingFeedbackService
  participant R as RetainedSessionsService (@Cron)
  participant BA as Bandit (/update + BanditArmState)
  Note over S: first user MOVE of a scheduled TASK
  S->>S: $tx( MOVE SessionEvent + lastMovedAt );  existing.lastMovedAt == null → firstMove
  S->>F: onFirstMove(userId, sessionId, moveEventId, dragMinutes)
  F->>F: slotProposal.findFirst(primaryPolicy LINUCB, selectedArm != null)
  F->>BA: reward = drag==0 ? 0 : -min(1, |drag|/240) → loadAll → /update → save → link event
  Note over R: every 30 min
  R->>R: sweep — elapsed, never-moved USER TASK → RETAINED event (+1)
  R->>BA: same loadAll → /update(+1) → save → link event
```

### Slot scoring — the overlap-weighted preference score

`slotPreferenceScore` (`core/slot-score.ts`) scores a concrete interval by how much of it
falls in each local **clock-hour block** it touches, weighted by that block's preference
value:

```text
score(slot) = Σ over each hour block [h, h+1) the slot touches:
                overlapFraction(slot ∩ [h, h+1)) · pref[weekday(h)][h]
```

A slot that only partially covers an hour contributes that hour fractionally — e.g. a
**09:15–11:00** slot scores `0.75·pref[..][9] + 1.0·pref[..][10]`. `[start, end)` is
half-open, so the block starting exactly at `end` is never scored. A midnight-spanning slot
is split at local midnight and each side scored against its own day's weekday row. The
matrix is **168 signed floats** — 7 ISO weekdays × 24 one-hour buckets, row-major
(`matrixIndex(isoWeekday, hour) = (isoWeekday−1)·24 + hour`).

### LinUCB slot score — cold-start blend

`linucbSlotScore` (`core/linucb-slot-score.ts`) for a candidate 15-min start:

```text
score(slot) = Σ_arm overlapRate(slot, arm) · predicted[day][arm]   (the LinUCB term)
            + slotPreferenceScore(slot)                            (cold-start blend)
```

The bandit service returns `0` for an arm with no accumulated reward, so the preference
addend keeps slots meaningfully ordered before the model has learned anything
(ADR-0001 §8).

### Series bounded window

For a `sessionCount > 1` `TASK` series, `seriesDayWindows(daySpan, N)` partitions the
`daySpan + 1` days into `N` contiguous, **non-overlapping** buckets — no two members' windows
can ever touch:

```text
totalDays = daySpan + 1
base      = floor(totalDays / N)             // days per member, at minimum
remainder = totalDays % N                    // the LAST `remainder` members get one extra day
```

Member `i`'s window is exactly its bucket: `base` days each, except the last `remainder`
members get `base + 1` (so the series still starts on day 0 and the slack lands closest to the
deadline). This replaced an earlier "even-spread target ± a symmetric clamp" scheme whose
windows could overlap between adjacent members — letting two sessions cluster onto the same
day while a neighboring day the series was supposed to use sat empty.

`daySpan` = whole days from the next 15-min boundary to the deadline day, capped at
`MAX_SCAN_DAYS − 1`. Each member is then placed by the same 50/50 pick as a single task
inside its window; already-placed siblings are fed forward as hard blocks so members never
overlap, and a day already holding `MAX_SERIES_PER_DAY` (1) sitting of this series is
skipped. A member that finds nowhere comes back unplaced without blocking the rest. `N` can
exceed `totalDays` (more sessions than days) — buckets then collapse toward the tail, several
members sharing one day's window; that's an unavoidable overlap the day cap and the series
pre-flight (`TaskPlacementService.canPlaceSeries`) keep safe, not this partition.

### Trace it in the source

| Concept                                                                             | File                                          |
| ----------------------------------------------------------------------------------- | --------------------------------------------- |
| preference matrix helpers (`matrixIndex`, default/effective, `preferenceScoreAt`)   | `scheduler/core/preference.ts`                |
| overlap-weighted slot score + best-free-slot search                                 | `scheduler/core/slot-score.ts`                |
| LinUCB slot score + cold-start blend                                                | `scheduler/core/linucb-slot-score.ts`         |
| the `d = 46` LinUCB context vector                                                  | `scheduler/core/context-vector.ts`            |
| 5 time-of-day arm bands + `overlapRate` (splits at midnight)                        | `scheduler/core/arms.ts`                      |
| series even spread + `± X/N` window                                                 | `scheduler/core/series-spread.ts`             |
| feature normalization (`minMaxSigned`, divisors)                                    | `scheduler/core/normalize.ts`                 |
| rrule expansion + occurrence-id helpers                                             | `scheduler/core/recurrence.ts`                |
| exponential preference-matrix decay                                                 | `scheduler/core/matrix-decay.ts`              |
| one day's occupied intervals + workload (the only occupancy query)                  | `scheduler/io/day-load.ts`                    |
| Policy A placer — `placeTask` / `placeInWindow`                                     | `scheduler/io/heuristic-placer.service.ts`    |
| Policy B placer — per-day `/predict` + slot pick                                    | `scheduler/io/bandit-placer.service.ts`       |
| per-member bounded 50/50 series placement                                           | `scheduler/io/series-placer.service.ts`       |
| the facade `sessions/` calls (place + persist + A/B)                                | `scheduler/io/task-placement.service.ts`      |
| delayed first-move LinUCB reward                                                    | `scheduler/io/scheduling-feedback.service.ts` |
| `RETAINED` sweep (+1 reward)                                                        | `scheduler/io/retained-sessions.service.ts`   |
| nightly matrix decay cron                                                           | `scheduler/io/matrix-decay.service.ts`        |
| 50/50 policy assignment + `SlotProposal` write                                      | `experiments/experiment.service.ts`           |
| tuning constants (`MAX_SCAN_DAYS`, `MAX_SERIES_PER_DAY`, `BANDIT_*`, reward scales) | `scheduler/constants.ts`                      |

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
