#!/bin/sh
# Scheduled snapshot of the uploaded files (the MinIO data volume), streamed so no
# temp disk is needed:
#   tar -> age -> s3://$BACKUP_S3_BUCKET/zenflow/<env>/files/YYYY/MM/DD/files-<ts>.tar.age
# It re-uploads everything each run, so it runs daily, not with the 3-hourly dump.
# Env (see lib.sh) plus: BACKUP_FILES_DIR (the mounted data dir), BACKUP_AGE_RECIPIENT.
# On success writes zenflow_backup_files_* textfile metrics. Restore: docs/ops/backups.md.
set -eu
. "$(dirname "$0")/lib.sh"
: "${BACKUP_AGE_RECIPIENT:?age public key(s), comma separated}"

step="setup"
trap 'rc=$?; record_run backup_files "$rc" "$step"' EXIT

if [ -z "${BACKUP_FILES_DIR:-}" ] || [ ! -d "$BACKUP_FILES_DIR" ]; then
  step="finding the files directory"
  log "ERROR BACKUP_FILES_DIR='${BACKUP_FILES_DIR:-}' is not a directory: uploaded files are NOT being backed up"
  exit 1
fi

recipients=""
for r in $(printf '%s' "$BACKUP_AGE_RECIPIENT" | tr ',' ' '); do
  recipients="$recipients -r $r"
done

ts="$(date -u +%Y%m%dT%H%M%SZ)"
dest="s3://$BACKUP_S3_BUCKET/$PREFIX/files/$(date -u +%Y/%m/%d)/files-$ts.tar.age"
# `aws s3 cp -` cannot know the size of a stream; give it an upper bound (the raw
# size plus slack) so a large archive does not exceed the multipart part limit.
kb="$(du -sk "$BACKUP_FILES_DIR" | cut -f1)"
expected=$(( kb * 1024 + 16 * 1024 * 1024 ))

log "archiving $BACKUP_FILES_DIR (~${kb} KiB)"
step="archive, encrypt and upload"
# A failure in any stage must fail the run, not just the last one.
set -o pipefail
# shellcheck disable=SC2086
tar -C "$BACKUP_FILES_DIR" -cf - . | age $recipients | s3 s3 cp --only-show-errors --expected-size "$expected" - "$dest"

step="reading the uploaded size"
size="$(s3 s3api head-object --bucket "$BACKUP_S3_BUCKET" --key "${dest#s3://$BACKUP_S3_BUCKET/}" --query ContentLength --output text)"
log "uploaded $dest ($size bytes)"
write_metric zenflow_backup_files_size zenflow_backup_files_last_size_bytes \
  "Size of the last uploaded encrypted files archive." "$size"
write_metric zenflow_backup_files_success zenflow_backup_files_last_success_timestamp_seconds \
  "Unix time of the last successful files backup." "$(date +%s)"
