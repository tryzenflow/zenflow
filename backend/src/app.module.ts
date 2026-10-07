import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import * as Joi from "@hapi/joi";
import { PrismaModule } from "./prisma/prisma.module";
import { AppService } from "./app.service";
import { AppController } from "./app.controller";
import { AuthModule } from "./auth/auth.module";
import { CacheModule } from "@nestjs/cache-manager";
import { createKeyv } from "@keyv/redis";
import { Keyv } from "keyv";
import { CacheableMemory } from "cacheable";
import { MailService } from "./mail/mail.service";
import { MailModule } from "./mail/mail.module";
import { UsersModule } from "./users/users.module";
import { SessionsModule } from "./sessions/sessions.module";
import { TagsModule } from "./tags/tags.module";
import { FilesModule } from "./files/files.module";
import { SchedulerModule } from "./scheduler/scheduler.module";
import { ScheduleModule } from "@nestjs/schedule";
import { RedisModule } from "./common/redis/redis.module";
import { RateLimitModule } from "./common/rate-limit";
import { CryptoModule } from "./crypto/crypto.module";
import { IntegrationsModule } from "./integrations/integrations.module";
import { LMSModule } from "./lms/lms.module";
import { PortalAPIModule } from "./portal/portal-api.module";
import { IngestionModule } from "./ingestion/ingestion.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { RemindersModule } from "./reminders/reminders.module";
import { DevicesModule } from "./devices/devices.module";
import { ObservabilityModule } from "./observability/observability.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath:
        process.env.NODE_ENV === "production" ? ".env.prod" : ".env.dev",
      validationSchema: Joi.object({
        DATABASE_URL: Joi.string().required(),
        SESSION_SECRET: Joi.string().required(),
        // Per-provider master keys for the DLU-credential envelope scheme (see
        // crypto/). 32 bytes, hex-encoded (64 chars) each. Each one wraps that
        // provider's per-user UserEncryptionKey rows; never stored in the DB.
        // The `_V<n>` suffix is the master-key version — add a new var (bump
        // MasterKeyService.CURRENT_MASTER_KEY_VERSION) to rotate; unwrapping an
        // old row still resolves its recorded version.
        MASTER_LMS_ENCRYPTION_KEY_V1: Joi.string()
          .length(64)
          .regex(/^[0-9a-fA-F]+$/, "hex")
          .required(),
        MASTER_PORTAL_ENCRYPTION_KEY_V1: Joi.string()
          .length(64)
          .regex(/^[0-9a-fA-F]+$/, "hex")
          .required(),
        // HMAC key for signed file URLs (files/). Rotating it invalidates every
        // link already stored in notes.
        FILE_URL_SECRET: Joi.string().min(32).required(),
        CORS_ORIGIN: Joi.string().required(),
        // S3-compatible object storage for uploaded files (files/). The bucket
        // must already exist — compose `storage-init` creates it.
        S3_ENDPOINT: Joi.string().uri().required(),
        S3_REGION: Joi.string().default("us-east-1"),
        S3_ACCESS_KEY_ID: Joi.string().required(),
        S3_SECRET_ACCESS_KEY: Joi.string().required(),
        S3_BUCKET: Joi.string().required(),
        // Where multer buffers uploads before they move to S3. Defaults to the
        // OS temp dir.
        UPLOAD_TMP_DIR: Joi.string().optional(),
        CACHE_URL: Joi.string().uri().required(),
        // Separate Redis instance dedicated to LimitKit's rate-limit
        // counters (see common/rate-limit/) — kept off the session/OTP
        // Redis (CACHE_URL) so counter churn can't evict that data.
        RATE_LIMIT_CACHE_URL: Joi.string().uri().required(),
        MAIL_TRANSPORT: Joi.string().uri().required(),
        MAIL_FROM: Joi.string().email().required(),
        // Idle session lifetime in ms; with rolling sessions, active use keeps
        // extending it. Defaults to 7 days. Drives both the cookie maxAge and
        // the Redis session TTL.
        SESSION_TTL_MS: Joi.number()
          .integer()
          .positive()
          .default(7 * 24 * 60 * 60 * 1000),
        // Session cookie flags, decoupled from NODE_ENV so each environment can
        // opt in independently. Production (cross-site FE on Netlify, API behind
        // TLS) needs COOKIE_SECURE=true + COOKIE_SAMESITE=none; same-origin dev
        // keeps the lax/insecure defaults.
        COOKIE_SECURE: Joi.boolean().default(true),
        COOKIE_SAMESITE: Joi.string()
          .valid("lax", "none", "strict")
          .default("lax"),
        // LimitKit rate limits on the OTP-sending auth endpoints (see
        // common/rate-limit/). Sliding windows, in seconds + max requests.
        OTP_REQUEST_IP_WINDOW_SEC: Joi.number()
          .integer()
          .positive()
          .default(60),
        OTP_REQUEST_IP_LIMIT: Joi.number().integer().positive().default(5),
        // Longer per-IP window: loose on purpose (campus NAT shares one IP).
        OTP_REQUEST_IP_HOURLY_WINDOW_SEC: Joi.number()
          .integer()
          .positive()
          .default(3600),
        OTP_REQUEST_IP_HOURLY_LIMIT: Joi.number()
          .integer()
          .positive()
          .default(20),
        OTP_REQUEST_EMAIL_WINDOW_SEC: Joi.number()
          .integer()
          .positive()
          .default(900), // 15 min
        OTP_REQUEST_EMAIL_LIMIT: Joi.number().integer().positive().default(3),
        OTP_VERIFY_IP_WINDOW_SEC: Joi.number().integer().positive().default(60),
        OTP_VERIFY_IP_LIMIT: Joi.number().integer().positive().default(20),
        OTP_VERIFY_EMAIL_WINDOW_SEC: Joi.number()
          .integer()
          .positive()
          .default(600), // 10 min
        OTP_VERIFY_EMAIL_LIMIT: Joi.number().integer().positive().default(10),
        // Manual `POST /integrations/:provider/sync`, per user + provider
        // (`@RateLimit` on the controller, common/rate-limit/). Sliding window.
        SYNC_MANUAL_LIMIT: Joi.number().integer().positive().default(3),
        SYNC_MANUAL_WINDOW_SEC: Joi.number()
          .integer()
          .positive()
          .default(21600), // 6 h
        // Per-command timeout for the rate-limit Redis; on timeout/error the
        // limiter fails open (common/rate-limit/resilient-store.ts).
        RATE_LIMIT_STORE_TIMEOUT_MS: Joi.number()
          .integer()
          .positive()
          .default(250),
        PORTAL_API_KEY: Joi.string().required(),
        // DKHP (course-registration) API: base URL and key for the
        // registration-history call that drives enrolment discovery. No
        // default — the host is deployment-specific. Optional at boot so an
        // existing deployment that has not been given them still starts;
        // DKHP calls fail per-pass (and are logged) until they are set. The
        // key is never logged.
        DKHP_API_URL: Joi.string().uri().optional(),
        DKHP_API_KEY: Joi.string().optional(),
        // --- DLU ingestion (lms/, portal/, ingestion/) ---------------------
        // These three are read with `getOrThrow` by LMSService /
        // PortalAPIService, so they must always resolve — the defaults below
        // are the real public DLU endpoints and exist so a deployment that
        // forgets them still boots instead of throwing at construction.
        // Base URL of the DLU Moodle LMS (lms/lms.service.ts).
        LMS_URL: Joi.string().uri().default("https://lms.dlu.edu.vn"),
        // Base URL of the DLU student-portal JSON API
        // (portal/portal-api.service.ts).
        PORTAL_API_URL: Joi.string()
          .uri()
          .default("https://portal-api.dlu.edu.vn"),
        // Per-request timeouts in ms (both services use AbortSignal.timeout).
        // The LMS budget is the looser of the two: its login is a multi-step
        // form flow, not a single JSON call.
        PORTAL_API_TIMEOUT_MS: Joi.number().integer().positive().default(10000),
        LMS_TIMEOUT_MS: Joi.number().integer().positive().default(15000),
        // IANA timezone every DLU wall-clock string (timetable `Ngay`/`GioThi`,
        // exam schedules) is expressed in. Not the user's timezone — it is a
        // property of the upstream data, so it is config, not per-user state.
        DLU_TZ: Joi.string().default("Asia/Ho_Chi_Minh"),
        // Kill switch for the ingestion crons. Off means the watchers stay
        // registered but return immediately, so a misbehaving upstream can be
        // shut out without a redeploy of the whole API.
        INGESTION_ENABLED: Joi.boolean().default(true),
        // Fixed pause between a watcher's outbound requests, in ms. This is
        // the entirety of the baseline's politeness policy (no queue, no rate
        // limiter, no circuit breaker — all deliberately deferred), so it is
        // config rather than a constant: DLU's tolerance can be discovered
        // without a redeploy. `0` in `.env.test` so a suite never waits on it.
        INGESTION_REQUEST_DELAY_MS: Joi.number().integer().min(0).default(750),
        // --- DLU ingestion: the rolling scheduler (issue #56) --------------
        // The three watchers no longer carry a `@Cron`. `IngestionTickerService`
        // fires every minute and claims only the most-overdue few students per
        // kind, so the same daily volume is spread continuously instead of
        // sweeping the whole population at one instant. The cadence lives
        // entirely in these periods plus each row's `nextDueAt`; the heartbeat
        // is a fixed literal and deliberately not configurable (see the note on
        // `IngestionTickerService`).
        //
        // How often each student should be refreshed, per kind. The LMS calendar
        // is the only frequent one: a deadline can move at any hour, while a
        // timetable or exam schedule changes a handful of times a term.
        INGESTION_PORTAL_DISCOVERY_PERIOD_MS: Joi.number()
          .integer()
          .positive()
          .default(24 * 60 * 60_000),
        INGESTION_LMS_DISCOVERY_PERIOD_MS: Joi.number()
          .integer()
          .positive()
          .default(24 * 60 * 60_000),
        INGESTION_TIMETABLE_PERIOD_MS: Joi.number()
          .integer()
          .positive()
          .default(24 * 60 * 60_000),
        INGESTION_EXAM_PERIOD_MS: Joi.number()
          .integer()
          .positive()
          .default(24 * 60 * 60_000),
        INGESTION_LMS_CALENDAR_PERIOD_MS: Joi.number()
          .integer()
          .positive()
          .default(60 * 60_000),
        // Hard ceiling on how many students one tick may claim for one kind.
        // The safety rail that makes "the load is spread" a property of the code
        // rather than of whoever last edited this file. A measurement run lifts
        // it on purpose, together with 60s periods, to replay the pre-#56 burst.
        INGESTION_TICK_MAX_BATCH: Joi.number().integer().positive().default(5),
        // Stop claiming further kinds once a tick has spent this long, so one
        // slow kind cannot push a tick past the next heartbeat. A deferred
        // target simply stays overdue and leads the next tick.
        INGESTION_TICK_BUDGET_MS: Joi.number()
          .integer()
          .positive()
          .default(48_000),
        // --- DLU ingestion: the cross-student occurrence cache (issue #56) --
        // The rollout gate. Off by default, and the inverse of
        // INGESTION_ENABLED's "absent means on": this one lets a walk be SKIPPED
        // and lets one student's fetch write another student's calendar, which
        // is behaviour that can silently drop a class if the confirmed-set
        // plumbing is wrong. Recording occurrences from a walk that happened
        // anyway is deliberately NOT gated, so flipping this on finds a warm,
        // already-validated cache. See `isOccurrenceCacheEnabled`.
        INGESTION_OCCURRENCE_CACHE_ENABLED: Joi.boolean().default(false),
        // How long a section's/course's cached occurrences are served before one
        // student's live walk refreshes them for everyone.
        INGESTION_CACHE_TTL_MS: Joi.number()
          .integer()
          .positive()
          .default(7 * 24 * 60 * 60_000),
        // Hard staleness ceiling on a student's confirmed set. Past this a walk
        // pass stops trusting discovery and does the full live walk. Two
        // discovery periods, so one missed pass is tolerated.
        INGESTION_DISCOVERY_MAX_AGE_MS: Joi.number()
          .integer()
          .positive()
          .default(48 * 60 * 60_000),
        // Force a full live walk every N consecutive cache-served passes. The
        // audit that bounds how wrong the cache can quietly be: without it a
        // cohort could sit indefinitely on occurrences that keep looking fresh.
        INGESTION_FULL_WALK_EVERY: Joi.number().integer().positive().default(7),
        // Cap on how many classmates one fan-out may write to, so a shared
        // elective cannot turn one tick into a thousand writes. The remainder
        // pick the change up on their own next pass.
        INGESTION_FANOUT_MAX_STUDENTS: Joi.number()
          .integer()
          .positive()
          .default(200),
        // Whether the Moodle current-term filter may narrow a student's course
        // set. "shadow" (default) records and meters its verdict but gates
        // nothing — issue #56 requires the filter be validated against a real
        // account before it can cause a skip. "enforce" acts on it; "off" is
        // shadow, said deliberately.
        INGESTION_LMS_TERM_FILTER: Joi.string()
          .valid("off", "shadow", "enforce")
          .default("shadow"),
        // Base URL of the stateless Python bandit service
        // (services/bandit/, docs/adr/0001-linucb-model-design.md). Optional:
        // when unset, LinUCB scheduling is disabled and every event falls back
        // to the heuristic.
        // ADR-0003: REQUIRED when NODE_ENV=production (boot fails otherwise);
        // dev/test may leave it unset and run degraded (frozen TS heuristic).
        BANDIT_SERVICE_URL: Joi.string().uri().when(Joi.ref("NODE_ENV"), {
          is: "production",
          then: Joi.required(),
          otherwise: Joi.optional(),
        }),
        // Optional shared bearer secret sent as `Authorization: Bearer` on
        // /v1/place (the Python side verifies it; /health and /ready exempt).
        BANDIT_SERVICE_TOKEN: Joi.string().optional(),
        // Total per-call budget for POST /v1/place, ms (ADR-0003: 2500).
        PLACE_TIMEOUT_MS: Joi.number().integer().min(100).default(2500),
        // "1" => emit a `Server-Timing` header on responses (bench/test env).
        BENCH_TIMING: Joi.string().valid("0", "1").optional(),
        // --- Native mobile push (devices/) --------------------------------
        // Each provider self-disables when its vars are unset, like
        // BANDIT_SERVICE_URL: FcmSender needs FCM_SERVICE_ACCOUNT, ApnsSender
        // needs all four APNS_* below. With neither configured, POST /devices
        // still records tokens but nothing is ever sent.
        // Base64 of the Firebase service-account JSON (the `project_id` is
        // inside it). Android delivery via firebase-admin.
        FCM_SERVICE_ACCOUNT: Joi.string().optional(),
        // Base64 of the APNs auth key (`AuthKey_XXXXXXXXXX.p8` contents) plus
        // its 10-char key id, the Apple team id, and the app bundle id (which
        // is the APNs `topic`). iOS delivery via @parse/node-apn, token auth.
        APNS_KEY: Joi.string().optional(),
        APNS_KEY_ID: Joi.string().optional(),
        APNS_TEAM_ID: Joi.string().optional(),
        APNS_BUNDLE_ID: Joi.string().optional(),
        // true -> api.push.apple.com, false -> the sandbox gateway.
        APNS_PRODUCTION: Joi.boolean().default(false),
        // --- Observability (observability/, tracing.ts) -------------------
        // NODE_ENV is also read directly by several modules; declare it so it
        // has one validated default. `tracing.ts` reads the OTEL_* vars
        // itself (it is preloaded before Nest), they are listed here only so
        // a deployment sees them documented + defaulted.
        NODE_ENV: Joi.string()
          .valid("development", "production", "test")
          .default("development"),
        LOG_LEVEL: Joi.string()
          .valid("trace", "debug", "info", "warn", "error", "fatal", "silent")
          .optional(),
        // Overrides package.json version in logs / the OTel resource.
        SERVICE_VERSION: Joi.string().optional(),
        OTEL_SERVICE_NAME: Joi.string().default("zenflow-api"),
        // OTLP/HTTP collector base (the SDK appends /v1/traces, /v1/metrics).
        OTEL_EXPORTER_OTLP_ENDPOINT: Joi.string()
          .uri()
          .default("http://localhost:4318"),
        // "true" turns the whole SDK into a no-op (tracing.ts short-circuits).
        OTEL_SDK_DISABLED: Joi.boolean().default(false),
        OTEL_TRACES_SAMPLER: Joi.string().default("parentbased_traceidratio"),
        OTEL_TRACES_SAMPLER_ARG: Joi.number().min(0).max(1).default(1),
        OTEL_METRIC_EXPORT_INTERVAL_MS: Joi.number()
          .integer()
          .positive()
          .default(60000),
        // A request at/above this many ms is always logged, sampling aside.
        HTTP_SLOW_REQUEST_MS: Joi.number().integer().positive().default(1000),
      }),
    }),
    // Logging + CLS correlation + the global exception filter / HTTP metrics
    // interceptor. First so its Nest logger and filter cover everything below.
    ObservabilityModule,
    ScheduleModule.forRoot(),
    CacheModule.registerAsync({
      isGlobal: true,
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        return {
          stores: [
            new Keyv({
              store: new CacheableMemory({ ttl: 900000, lruSize: 10000 }),
            }),
            createKeyv(configService.get("CACHE_URL")),
          ],
        };
      },
    }),
    RedisModule,
    RateLimitModule,
    UsersModule,
    PrismaModule,
    AuthModule,
    MailModule,
    SessionsModule,
    CryptoModule,
    LMSModule,
    PortalAPIModule,
    TagsModule,
    FilesModule,
    // Background cron providers (MatrixDecayService, RetainedSessionsService)
    // plus HeuristicScheduleService / BanditScheduleService, the single-session
    // placers SessionsService calls on create / deadline-edit. No day repack —
    // an existing session is never moved; see scheduler.module.ts.
    SchedulerModule,
    IntegrationsModule,
    // The three DLU watcher crons (@Cron) plus their write-back; mutually
    // dependent with IntegrationsModule via forwardRef, see ingestion.module.ts.
    IngestionModule,
    NotificationsModule,
    // Native mobile push — a second subscriber to the notification emitter
    // (like the SSE stream), plus POST/DELETE /devices. Self-disables per
    // provider when its FCM_*/APNS_* env is unset; see devices.module.ts.
    DevicesModule,
    // Per-session reminders: SchedulerRegistry one-shot timers -> notifications.
    RemindersModule,
  ],
  providers: [AppService, MailService],
  controllers: [AppController],
})
export class AppModule {}
