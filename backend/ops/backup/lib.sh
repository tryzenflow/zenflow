# Shared helpers for backup.sh / restore-test.sh. Sourced, not executed.
# Env: BACKUP_ENV, BACKUP_S3_BUCKET, BACKUP_S3_ENDPOINT (blank = AWS),
#      BACKUP_S3_REGION, BACKUP_S3_ACCESS_KEY_ID, BACKUP_S3_SECRET_ACCESS_KEY,
#      POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_DB, METRICS_DIR.

: "${BACKUP_ENV:?staging|prod}" "${BACKUP_S3_BUCKET:?}"
: "${BACKUP_S3_ACCESS_KEY_ID:?}" "${BACKUP_S3_SECRET_ACCESS_KEY:?}"
: "${POSTGRES_USER:?}" "${POSTGRES_PASSWORD:?}" "${POSTGRES_DB:?}"

export AWS_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION="${BACKUP_S3_REGION:-us-east-1}"
export PGHOST="${PGHOST:-postgres}" PGUSER="$POSTGRES_USER" PGPASSWORD="$POSTGRES_PASSWORD"
METRICS_DIR="${METRICS_DIR:-/metrics}"
PREFIX="zenflow/$BACKUP_ENV"

log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*"; }

# s3 <aws s3 args...>: adds --endpoint-url only when a custom endpoint (MinIO) is set.
s3() {
  if [ -n "${BACKUP_S3_ENDPOINT:-}" ]; then
    aws --endpoint-url "$BACKUP_S3_ENDPOINT" "$@"
  else
    aws "$@"
  fi
}

# write_metric <file> <name> <help> <value>: atomic textfile-collector write.
write_metric() {
  mkdir -p "$METRICS_DIR"
  {
    printf '# HELP %s %s\n# TYPE %s gauge\n' "$2" "$3" "$2"
    printf '%s{env="%s"} %s\n' "$2" "$BACKUP_ENV" "$4"
  } >"$METRICS_DIR/$1.tmp"
  mv "$METRICS_DIR/$1.tmp" "$METRICS_DIR/$1.prom"
}
