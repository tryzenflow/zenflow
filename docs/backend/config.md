# Backend configuration

For: developers and operators setting up the API. Source of truth: the Joi schema in [`app.module.ts`](../../backend/src/app.module.ts) and [`.env.example`](../../backend/.env.example).

- Copy `.env.example` to `.env.{dev,staging,prod,test}`. All vars are validated at boot (`@hapi/joi`).
- Any variable can be given as `FOO_FILE=/path` (contents become `FOO`; explicit `FOO` wins; see `src/common/config/file-secrets.ts`).
- Deployed environments inject secrets from a managed store. Inventory, rotation, Vault (prod only): [secrets.md](../ops/secrets.md). CI/CD and rollback: [ci-cd.md](../ops/ci-cd.md).

## Core

| Var | Default | Notes |
| --- | --- | --- |
| `DATABASE_URL` | none | Required. |
| `CACHE_URL` | none | Required. Redis for sessions, OTP, cache. |
| `RATE_LIMIT_CACHE_URL` | none | Required. Dedicated Redis for LimitKit; see [ADR-0005](../adr/0005-rate-limit-store-lru-rdb.md). |
| `CORS_ORIGIN` | none | Required. |
| `SESSION_SECRET` | none | Required. |
| `SESSION_TTL_MS` | 604800000 (7 d) | Idle lifetime; rolling. Drives cookie `maxAge` and Redis TTL. |
| `COOKIE_SECURE` / `COOKIE_SAMESITE` | `true` / `lax` | Cross-site prod needs `true` + `none`. |
| `MAIL_TRANSPORT` / `MAIL_FROM` | none | Required. `MAIL_TRANSPORT` is an SMTP URI. |
| `MASTER_LMS_ENCRYPTION_KEY_V1` / `MASTER_PORTAL_ENCRYPTION_KEY_V1` | none | Required. 64 hex chars (`openssl rand -hex 32`). Add `_V<n>` to rotate. |
| `FILE_URL_SECRET` | none | Required, 32+ chars. HMAC for signed file URLs; rotating breaks stored links. |
| `S3_ENDPOINT` | none | Required. `http://storage:9000` in compose; `http://localhost:9000` for host `start:dev`. |
| `S3_REGION` | `us-east-1` | |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` / `S3_BUCKET` | none | Required. Bucket must exist (compose creates it). |
| `UPLOAD_TMP_DIR` | none | Optional upload buffer dir. |
| `PORT` | 8000 | |
| `NODE_ENV` | `development` | `production` makes `BANDIT_SERVICE_URL` required and turns Swagger (`/api`) off. |
| `SWAGGER_ENABLED` | unset | `true` keeps Swagger on under `NODE_ENV=production` (staging only). |

## Rate limits

Sliding windows; `*_WINDOW_SEC` in seconds, `*_LIMIT` max requests per window. Rules and fail-open behaviour: [api.md](api.md#rate-limits).

| Var | Default |
| --- | --- |
| `OTP_REQUEST_IP_WINDOW_SEC` / `_LIMIT` | 60 / 5 |
| `OTP_REQUEST_IP_HOURLY_WINDOW_SEC` / `_LIMIT` | 3600 / 20 |
| `OTP_REQUEST_EMAIL_WINDOW_SEC` / `_LIMIT` | 900 / 3 |
| `OTP_VERIFY_IP_WINDOW_SEC` / `_LIMIT` | 60 / 20 |
| `OTP_VERIFY_EMAIL_WINDOW_SEC` / `_LIMIT` | 600 / 10 |
| `RATE_LIMIT_STORE_TIMEOUT_MS` | 250 |
| `SYNC_MANUAL_COOLDOWN_SEC` | 900 | Minimum gap between two syncs of one provider (manual or background). |

## DLU ingestion

Behaviour: [ingestion.md](ingestion.md).

| Var | Default | Notes |
| --- | --- | --- |
| `LMS_URL` | `https://lms.dlu.edu.vn` | Upstream base URL. |
| `PORTAL_API_URL` | `https://portal-api.dlu.edu.vn` | Upstream base URL. |
| `PORTAL_API_KEY` | none | Required. |
| `DKHP_API_URL` / `DKHP_API_KEY` | none | Optional in the schema; DKHP (course registration) base URL and key. Its registration history drives enrolment discovery. |
| `LMS_TIMEOUT_MS` / `PORTAL_API_TIMEOUT_MS` | 15000 / 10000 | Per-request timeouts. |
| `DLU_TZ` | `Asia/Ho_Chi_Minh` | Zone of upstream wall-clock strings, not the user's. |
| `INGESTION_ENABLED` | `true` | Kill switch; `false` in `.env.test`. |
| `INGESTION_REQUEST_DELAY_MS` | 750 | Pause between one watcher's requests (0 in tests). |
| `INGESTION_PORTAL_DISCOVERY_PERIOD_MS` | 120 d | Safety-net DKHP discovery period. A clean pass parks the row until the next term's window opens (2 weeks before it starts), so DKHP is asked about once per term. |
| `INGESTION_LMS_DISCOVERY_PERIOD_MS` | 86400000 | |
| `INGESTION_TIMETABLE_PERIOD_MS` | 86400000 | |
| `INGESTION_EXAM_PERIOD_MS` | 86400000 | |
| `INGESTION_LMS_CALENDAR_PERIOD_MS` | 3600000 | |
| `INGESTION_TICK_MAX_BATCH` | 5 in schema; 20 in `ingestion-ticker.service.ts` | Max students one tick claims per kind. |
| `INGESTION_TICK_BUDGET_MS` | 48000 | Stop starting further kinds once a tick has run this long. |
| `INGESTION_BREAKER_FAILURES` / `_OPEN_MS` / `_MAX_OPEN_MS` | 5 / 60000 / 600000 | Breakers for all upstreams. |
| `INGESTION_OCCURRENCE_CACHE_ENABLED` | `false` | Gate for cache-served walks and fan-out. Discovery is always on. |
| `INGESTION_CACHE_TTL_MS` | 604800000 (7 d) | Past it, a live walk refreshes the cache. |
| `INGESTION_DISCOVERY_MAX_AGE_MS` | 172800000 (48 h) | Older Moodle confirmed set is ignored; walk live. |
| `INGESTION_FULL_WALK_EVERY` | 7 | Force a live walk every N cache-served passes. |
| `INGESTION_FANOUT_MAX_STUDENTS` | 200 | Max classmates one change fans out to per pass. |
| `INGESTION_LMS_TERM_FILTER` | `shadow` | `off`, `shadow` (log only) or `enforce`. Keep `shadow` until validated on a real account. |

## Placement, push, observability

| Var | Default | Notes |
| --- | --- | --- |
| `BANDIT_SERVICE_URL` | dev: `http://localhost:8100` | Unset means every placement uses the frozen `FallbackPlacer`. **Required when `NODE_ENV=production`.** |
| `BANDIT_SERVICE_TOKEN` | none | Optional bearer secret for `POST /v1/place`. |
| `PLACE_TIMEOUT_MS` | 2500 | Total `/v1/place` timeout (min 100). |
| `BENCH_TIMING` | none | `1` emits a `Server-Timing` header (test env only). |
| `FCM_SERVICE_ACCOUNT` | none | Enables Android push (base64 service-account JSON). |
| `APNS_KEY` / `APNS_KEY_ID` / `APNS_TEAM_ID` / `APNS_BUNDLE_ID` | none | All four enable iOS push. `APNS_KEY` is base64 of the `.p8`. |
| `APNS_PRODUCTION` | `false` | `true` uses `api.push.apple.com`, else the sandbox. |
| `OTEL_SDK_DISABLED` | `false` | `true` makes tracing a no-op. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318` | `http://otel-collector:4318` in the compose stack. |
| `OTEL_SERVICE_NAME` | `zenflow-api` | |
| `OTEL_TRACES_SAMPLER` / `OTEL_TRACES_SAMPLER_ARG` | `parentbased_traceidratio` / 1 | Ratio 0..1. |
| `OTEL_METRIC_EXPORT_INTERVAL_MS` | 60000 | |
| `LOG_LEVEL` | `info` in production, else `debug` | pino level. |
| `HTTP_SLOW_REQUEST_MS` | 1000 | Slower requests are always logged. |
| `SERVICE_VERSION` | `package.json` version | Overrides version in logs and OTel. |
| `GRAFANA_ADMIN_PASSWORD` / `GRAFANA_ROOT_URL` | `admin` / `http://localhost:3000` | Read by compose; see [observability](../../backend/observability/README.md). |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `admin` / none / `zenflow` | Read by compose; must match `DATABASE_URL`. |
