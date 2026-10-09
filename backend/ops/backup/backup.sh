#!/bin/sh
# Scheduled Postgres (and, with BACKUP_VAULT_DIR, Vault file-storage) backup:
#   pg_dump -Fc -> age -> s3://$BACKUP_S3_BUCKET/zenflow/<env>/YYYY/MM/DD/
# BACKUP_AGE_RECIPIENT is one or more age public keys, comma separated. The private
# key is never on this host. On success writes zenflow_backup_* textfile metrics.
# Env (see lib.sh) plus: BACKUP_MIN_BYTES (default 1024), BACKUP_VAULT_DIR (prod),
# BACKUP_CREATE_BUCKET=1 (staging/MinIO only: create the bucket if missing),
# BACKUP_PRUNE_DAYS=N (staging/MinIO only: delete objects whose date folder is older
# than N days; prod uses an S3 lifecycle rule because its IAM user cannot delete).
set -eu
. "$(dirname "$0")/lib.sh"
: "${BACKUP_AGE_RECIPIENT:?age public key(s), comma separated}"

MIN_BYTES="${BACKUP_MIN_BYTES:-1024}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

recipients=""
for r in $(printf '%s' "$BACKUP_AGE_RECIPIENT" | tr ',' ' '); do
  recipients="$recipients -r $r"
done

if [ "${BACKUP_CREATE_BUCKET:-0}" = 1 ]; then
  s3 s3api head-bucket --bucket "$BACKUP_S3_BUCKET" >/dev/null 2>&1 ||
    s3 s3 mb "s3://$BACKUP_S3_BUCKET" >/dev/null
fi

ts="$(date -u +%Y%m%dT%H%M%SZ)"
dest="s3://$BACKUP_S3_BUCKET/$PREFIX/$(date -u +%Y/%m/%d)"

log "pg_dump $POSTGRES_DB"
pg_dump -Fc -d "$POSTGRES_DB" -f "$WORK/db.dump"
# shellcheck disable=SC2086
age $recipients -o "$WORK/db.dump.age" "$WORK/db.dump"
rm -f "$WORK/db.dump"
s3 s3 cp --only-show-errors "$WORK/db.dump.age" "$dest/zenflow-$ts.dump.age"
size="$(wc -c <"$WORK/db.dump.age")"
log "uploaded $dest/zenflow-$ts.dump.age ($size bytes)"

if [ -n "${BACKUP_VAULT_DIR:-}" ] && [ -d "$BACKUP_VAULT_DIR" ]; then
  tar -C "$BACKUP_VAULT_DIR" -cf "$WORK/vault.tar" .
  # shellcheck disable=SC2086
  age $recipients -o "$WORK/vault.tar.age" "$WORK/vault.tar"
  s3 s3 cp --only-show-errors "$WORK/vault.tar.age" "$dest/vault-$ts.tar.age"
  log "uploaded vault snapshot"
fi

# Retention by age, using the YYYY/MM/DD folder in the key. Never fails the backup.
if [ -n "${BACKUP_PRUNE_DAYS:-}" ]; then
  cutoff="$(date -u -d "@$(( $(date +%s) - BACKUP_PRUNE_DAYS * 86400 ))" +%Y/%m/%d)"
  s3 s3 ls --recursive "s3://$BACKUP_S3_BUCKET/$PREFIX/" |
    awk -v p="$PREFIX/" -v c="$cutoff" '{ k = $4; if (index(k, p) == 1 && substr(k, length(p) + 1, 10) < c) print k }' |
    while read -r k; do
      s3 s3 rm --only-show-errors "s3://$BACKUP_S3_BUCKET/$k" && log "pruned $k"
    done || log "WARN prune failed"
fi

write_metric zenflow_backup_size zenflow_backup_last_size_bytes \
  "Size of the last uploaded encrypted dump." "$size"
if [ "$size" -lt "$MIN_BYTES" ]; then
  log "ERROR dump is $size bytes, below BACKUP_MIN_BYTES=$MIN_BYTES; not recording success"
  exit 1
fi
write_metric zenflow_backup_success zenflow_backup_last_success_timestamp_seconds \
  "Unix time of the last successful backup." "$(date +%s)"
