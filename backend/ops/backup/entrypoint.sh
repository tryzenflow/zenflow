#!/bin/sh
# Backup container entrypoint: install tools, render a crontab from env, run crond.
#   BACKUP_CRON         backup schedule        (default 0 2 * * *)
#   RESTORE_TEST_CRON   restore test schedule  (default 0 4 * * 0,3: Sun and Wed)
#   FILES_BACKUP_CRON   uploaded-files backup schedule (default 30 3 * * *: daily), only when BACKUP_FILES_DIR is set
#   BACKUP_ON_START=1   also run one backup at boot (smoke test)
# crond does not pass the container env to jobs, so it is snapshotted to /run/backup.env.
set -eu
DIR="$(dirname "$0")"

command -v age >/dev/null && command -v aws >/dev/null || apk add --no-cache age aws-cli >/dev/null

(umask 077; export -p >/run/backup.env)
job() { printf '%s . /run/backup.env; flock -n /tmp/%s.lock sh %s/%s >/proc/1/fd/1 2>&1\n' "$1" "$2" "$DIR" "$3"; }
{
  job "${BACKUP_CRON:-0 2 * * *}" backup backup.sh
  [ -z "${BACKUP_AGE_IDENTITY:-}" ] || job "${RESTORE_TEST_CRON:-0 4 * * 0,3}" restore restore-test.sh
  [ -z "${BACKUP_FILES_DIR:-}" ] || job "${FILES_BACKUP_CRON:-30 3 * * *}" files backup-files.sh
} >/etc/crontabs/root

[ "${BACKUP_ON_START:-0}" != 1 ] || sh "$DIR/backup.sh" || true
exec crond -f -l 8
