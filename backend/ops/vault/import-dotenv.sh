#!/usr/bin/env bash
# One-time migration of a trusted, single-line .env file into Vault KV v2.
#
#   VAULT_ADDR=http://127.0.0.1:8200 VAULT_TOKEN=... VAULT_ENV=prod \
#     ./ops/vault/import-dotenv.sh .env.prod
#
# Imports SECRETS ONLY into one set per consumer under secret/zenflow/$VAULT_ENV/:
# api, bandit, postgres, minio, grafana, backup (see secret_sets below; a secret a
# few containers share is written to each of their sets). Known non-secret keys
# stay in the env file (backend/env/<env>.env) and are only listed. An unknown key
# is an error, so nothing lands in a set by default. It does not source the dotenv
# file, print values, or write temporary plaintext files.
# Inspect the resulting key names with --dry-run before importing.
set -euo pipefail

: "${VAULT_ADDR:?}" "${VAULT_TOKEN:?}" "${VAULT_ENV:?dev|staging|prod}"
case "$VAULT_ENV" in dev|staging|prod) ;; *) echo "VAULT_ENV must be dev|staging|prod" >&2; exit 2;; esac
dotenv_file="${1:?usage: import-dotenv.sh .env.prod [--dry-run]}"
dry_run="${2:-}"
[ -r "$dotenv_file" ] || { echo "cannot read $dotenv_file" >&2; exit 2; }
case "$dry_run" in ""|--dry-run) ;; *) echo "unknown option $dry_run" >&2; exit 2;; esac
command -v curl >/dev/null && command -v jq >/dev/null || { echo "import-dotenv: curl and jq are required" >&2; exit 1; }

# classify <KEY>: prints the sets a secret belongs to, "env" for a known
# non-secret (stays in the env file), or fails with a hint for anything else.
classify() {
  case "$1" in
    SESSION_SECRET|FILE_URL_SECRET|MAIL_PASSWORD|PORTAL_API_KEY|DKHP_API_KEY|FCM_SERVICE_ACCOUNT|APNS_KEY|APNS_KEY_ID|APNS_TEAM_ID) echo api ;;
    MASTER_LMS_ENCRYPTION_KEY_V[0-9]*|MASTER_PORTAL_ENCRYPTION_KEY_V[0-9]*) echo api ;;
    POSTGRES_PASSWORD) echo "api postgres backup" ;;
    S3_ACCESS_KEY_ID|S3_SECRET_ACCESS_KEY) echo "api minio" ;;
    BANDIT_SERVICE_TOKEN) echo "api bandit" ;;
    BANDIT_SERVICE_TOKEN_PREVIOUS) echo bandit ;;
    GF_SECURITY_ADMIN_PASSWORD|GF_SMTP_PASSWORD) echo grafana ;;
    BACKUP_S3_ACCESS_KEY_ID|BACKUP_S3_SECRET_ACCESS_KEY|BACKUP_AGE_IDENTITY) echo backup ;;
    SESSION_REDIS_PASSWORD|RATE_LIMIT_REDIS_PASSWORD|QUEUE_REDIS_PASSWORD|REDIS_KILLSWITCH_PASSWORD|REDIS_PUBSUB_PASSWORD)
      echo "import-dotenv: $1 has no set: prod Redis runs without requirepass. Remove it, or add a redis set if you enable one" >&2; return 1 ;;
    # Known non-secrets: identifiers, hosts, ports, URLs without credentials, tunables.
    DB_HOST|DB_PORT|DB_SCHEMA|DB_SSLMODE|POSTGRES_USER|POSTGRES_DB) echo env ;;
    SESSION_REDIS_HOST|SESSION_REDIS_PORT|RATE_LIMIT_REDIS_HOST|RATE_LIMIT_REDIS_PORT|QUEUE_REDIS_HOST|QUEUE_REDIS_PORT|REDIS_KILLSWITCH_HOST|REDIS_KILLSWITCH_PORT|REDIS_PUBSUB_HOST|REDIS_PUBSUB_PORT) echo env ;;
    MAIL_HOST|MAIL_PORT|MAIL_SECURE|MAIL_USER|MAIL_FROM) echo env ;;
    S3_ENDPOINT|S3_REGION|S3_BUCKET|BACKUP_S3_BUCKET|BACKUP_S3_REGION|BACKUP_AGE_RECIPIENT|BACKUP_CRON|RESTORE_TEST_CRON|BACKUP_PRUNE_DAYS|BACKUP_MIN_BYTES) echo env ;;
    CORS_ORIGIN|COOKIE_SECURE|COOKIE_SAMESITE|SESSION_TTL_MS|GRPC_SCHEDULER_URL|GRAFANA_ROOT_URL) echo env ;;
    BANDIT_SERVICE_URL|PLACE_TIMEOUT_MS|PORTAL_API_URL|PORTAL_API_TIMEOUT_MS|DKHP_API_URL|LMS_URL|LMS_TIMEOUT_MS|DLU_TZ) echo env ;;
    LOG_LEVEL|HTTP_SLOW_REQUEST_MS|NODE_ENV|ROLE|SWAGGER_ENABLED|BENCH_TIMING|SERVICE_VERSION|UPLOAD_TMP_DIR|PAIRWISE_SAMPLE_RATE) echo env ;;
    RATE_LIMIT_STORE_TIMEOUT_MS|KILLSWITCH_CACHE_TTL_MS|REDIS_PUBSUB_TIMEOUT_MS|APNS_BUNDLE_ID|APNS_PRODUCTION) echo env ;;
    OTEL_SERVICE_NAME|OTEL_EXPORTER_OTLP_ENDPOINT|OTEL_SDK_DISABLED|OTEL_TRACES_SAMPLER|OTEL_TRACES_SAMPLER_ARG|OTEL_METRIC_EXPORT_INTERVAL_MS|OTEL_LOG_LEVEL) echo env ;;
    OTP_REQUEST_IP_WINDOW_SEC|OTP_REQUEST_IP_LIMIT|OTP_REQUEST_IP_HOURLY_WINDOW_SEC|OTP_REQUEST_IP_HOURLY_LIMIT|OTP_REQUEST_EMAIL_WINDOW_SEC|OTP_REQUEST_EMAIL_LIMIT) echo env ;;
    OTP_VERIFY_IP_WINDOW_SEC|OTP_VERIFY_IP_LIMIT|OTP_VERIFY_EMAIL_WINDOW_SEC|OTP_VERIFY_EMAIL_LIMIT) echo env ;;
    SYNC_MANUAL_WAIT_MS|SYNC_MANUAL_COOLDOWN_SEC) echo env ;;
    INGESTION_ENABLED|INGESTION_REQUEST_DELAY_MS|INGESTION_PORTAL_DISCOVERY_PERIOD_MS|INGESTION_LMS_DISCOVERY_PERIOD_MS|INGESTION_TIMETABLE_PERIOD_MS|INGESTION_EXAM_PERIOD_MS|INGESTION_LMS_CALENDAR_PERIOD_MS) echo env ;;
    INGESTION_TICK_MAX_BATCH|INGESTION_QUEUE_MAX_BACKLOG|INGESTION_TICK_BUDGET_MS|INGESTION_BREAKER_FAILURES|INGESTION_BREAKER_OPEN_MS|INGESTION_BREAKER_MAX_OPEN_MS) echo env ;;
    INGESTION_OCCURRENCE_CACHE_ENABLED|INGESTION_CACHE_TTL_MS|INGESTION_DISCOVERY_MAX_AGE_MS|INGESTION_FULL_WALK_EVERY|INGESTION_FANOUT_MAX_STUDENTS|INGESTION_LMS_TERM_FILTER) echo env ;;
    QUEUE_JOB_ATTEMPTS|QUEUE_BACKOFF_MS|QUEUE_ENQUEUE_TIMEOUT_MS|QUEUE_SHUTDOWN_TIMEOUT_MS) echo env ;;
    QUEUE_PORTAL_FETCH_CONCURRENCY|QUEUE_LMS_FETCH_CONCURRENCY|QUEUE_NOTIFY_CONCURRENCY) echo env ;;
    QUEUE_PORTAL_FETCH_RATE_MAX|QUEUE_PORTAL_FETCH_RATE_DURATION_MS|QUEUE_LMS_FETCH_RATE_MAX|QUEUE_LMS_FETCH_RATE_DURATION_MS|QUEUE_NOTIFY_RATE_MAX|QUEUE_NOTIFY_RATE_DURATION_MS) echo env ;;
    PORT|WORKER_PORT|KILLSWITCH_ACTOR) echo env ;;
    *) echo "import-dotenv: unknown key $1; add it to classify() in this script as a secret (with its sets) or a non-secret" >&2; return 1 ;;
  esac
}

emit_set() {
  local wanted="$1" line key value target
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line#"${line%%[![:space:]]*}"}"
    [ -z "$line" ] && continue
    [[ "$line" = \#* ]] && continue
    [[ "$line" = export\ * ]] && line="${line#export }"
    [[ "$line" = *=* ]] || { echo "import-dotenv: unsupported line in $dotenv_file" >&2; exit 2; }
    key="${line%%=*}"; value="${line#*=}"
    [[ "$key" =~ ^[A-Z][A-Z0-9_]*$ ]] || { echo "import-dotenv: invalid key $key" >&2; exit 2; }
    value="${value#"${value%%[![:space:]]*}"}"
    case "$value" in
      \"*|\'*)
        # Quoted: take up to the matching quote; only a comment may follow it.
        q="${value:0:1}"; rest="${value:1}"
        [[ "$rest" = *"$q"* ]] || { echo "import-dotenv: unterminated quote for $key" >&2; exit 2; }
        tail="${rest#*"$q"}"; value="${rest%%"$q"*}"
        tail="${tail#"${tail%%[![:space:]]*}"}"
        [ -z "$tail" ] || [[ "$tail" = \#* ]] || { echo "import-dotenv: unsupported text after quoted value for $key" >&2; exit 2; } ;;
      *)
        # Unquoted: an inline comment starts at whitespace followed by '#'.
        value="${value%%[[:space:]]#*}"
        value="${value%"${value##*[![:space:]]}"}" ;;
    esac
    target="$(classify "$key")" || exit 2
    [[ " $target " = *" $wanted "* ]] && printf '%s\0%s\0' "$key" "$value"
  done < "$dotenv_file"
  return 0
}

payload_for() {
  emit_set "$1" | jq -Rs '
    split("\u0000") | .[:-1] as $pairs |
    reduce range(0; $pairs | length; 2) as $i ({}; .[$pairs[$i]] = $pairs[$i + 1]) |
    {data: .}
  '
}

put_set() {
  local set="$1" payload
  payload="$(payload_for "$set")"
  printf '%s' "$payload" | jq -e '.data | length > 0' >/dev/null || return 0
  if [ "$dry_run" = --dry-run ]; then
    printf '%s: ' "$set"
    printf '%s' "$payload" | jq -r '.data | keys[]' | paste -sd, -
    return 0
  fi
  exec 3<<<"header = \"X-Vault-Token: $VAULT_TOKEN\""
  printf '%s' "$payload" | curl -fsS --max-time 15 -K /dev/fd/3 \
    -H 'Content-Type: application/json' -X POST --data @- \
    "$VAULT_ADDR/v1/secret/data/zenflow/$VAULT_ENV/$set" >/dev/null
  exec 3<&-
  echo "imported $set"
}

for set in api bandit postgres minio grafana backup; do put_set "$set"; done
if [ "$dry_run" = --dry-run ]; then
  printf 'left in env (not imported): '
  payload_for env | jq -r '.data | keys[]' | paste -sd, -
fi
