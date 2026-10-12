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

# record_run <job> <exit code> <step>: call from the job's EXIT trap. Writes whether
# the run succeeded and when it ran, and on failure logs one `ERROR ... during <step>`
# line. This is what the dashboard and the "backup failed" alert read, so a failed
# run shows up at once instead of only as a success that never came.
record_run() {
  _job="$1" _rc="$2" _step="$3"
  if [ "$_rc" -eq 0 ]; then _ok=1; else _ok=0; fi
  write_metric "zenflow_${_job}_run_ok" "zenflow_${_job}_last_run_ok" \
    "1 if the last ${_job} run succeeded, 0 if it failed." "$_ok" || true
  write_metric "zenflow_${_job}_run_time" "zenflow_${_job}_last_run_timestamp_seconds" \
    "Unix time the last ${_job} run finished, whatever the result." "$(date +%s)" || true
  [ "$_ok" -eq 1 ] || log "ERROR ${_job} failed (exit $_rc) during: $_step"
}
