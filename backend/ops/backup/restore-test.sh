#!/bin/sh
# Weekly restore test: newest dump from S3 -> age -d -> pg_restore into a throwaway
# database on the same server -> compare against live. Drops the database afterwards.
# BACKUP_AGE_IDENTITY is the age secret key of a restore-test recipient (not the
# offline master key). Without it the test is skipped and the restore metric goes stale.
set -eu
. "$(dirname "$0")/lib.sh"
: "${BACKUP_AGE_IDENTITY:?restore-test age secret key}"

TMPDB=zenflow_restore_test
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"; psql -d postgres -qc "DROP DATABASE IF EXISTS $TMPDB" >/dev/null 2>&1 || true' EXIT
umask 077
printf '%s\n' "$BACKUP_AGE_IDENTITY" >"$WORK/identity"

key="$(s3 s3 ls --recursive "s3://$BACKUP_S3_BUCKET/$PREFIX/" | awk '{print $4}' | grep '\.dump\.age$' | sort | tail -n1)"
[ -n "$key" ] || { log "ERROR no dump found under $PREFIX/"; exit 1; }
log "restoring $key"
s3 s3 cp --only-show-errors "s3://$BACKUP_S3_BUCKET/$key" "$WORK/db.dump.age"
age -d -i "$WORK/identity" -o "$WORK/db.dump" "$WORK/db.dump.age"

psql -d postgres -qc "DROP DATABASE IF EXISTS $TMPDB"
psql -d postgres -qc "CREATE DATABASE $TMPDB"
pg_restore --no-owner --exit-on-error -d "$TMPDB" "$WORK/db.dump"

count() { psql -d "$1" -Atc "$2"; }
tables='SELECT count(*) FROM information_schema.tables WHERE table_schema = '"'public'"
live_t="$(count "$POSTGRES_DB" "$tables")"
rest_t="$(count "$TMPDB" "$tables")"
[ "$rest_t" -gt 0 ] || { log "ERROR restored database has no tables"; exit 1; }
# The dump may be up to a backup interval old: restored may lag live, never exceed it.
if [ "$rest_t" -gt "$live_t" ]; then
  log "ERROR restored has $rest_t tables, live has $live_t"; exit 1
fi
mig='SELECT count(*) FROM _prisma_migrations'
rest_m="$(count "$TMPDB" "$mig")"
[ "$rest_m" -gt 0 ] || { log "ERROR restored _prisma_migrations is empty"; exit 1; }
log "restore OK: $rest_t tables, $rest_m migrations"

write_metric zenflow_backup_restore_success zenflow_backup_restore_last_success_timestamp_seconds \
  "Unix time of the last successful restore test." "$(date +%s)"
