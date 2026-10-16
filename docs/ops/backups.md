# Postgres backups

For operators. Issue #137, [ADR-0014](../adr/0014-postgres-backups-to-s3.md).

| Item | Value |
| --- | --- |
| Service | `backup` in `backend/compose.staging.yml` and `compose.prod.yml` (own `crond`) |
| Scripts | `backend/ops/backup/` (`backup.sh`, `restore-test.sh`, `backup-files.sh`, `entrypoint.sh`) |
| Dump | `s3://$BACKUP_S3_BUCKET/zenflow/<env>/YYYY/MM/DD/zenflow-<ts>.dump.age` plus `vault-<ts>.tar.age` |
| Format | `pg_dump -Fc`, encrypted with [age](https://age-encryption.org) |
| Files (prod) | `zenflow/prod/files/YYYY/MM/DD/files-<ts>.tar.age`, daily tar of `storage_data`. Cron: `FILES_BACKUP_CRON` (default `30 3 * * *`) |
| Staging | backup every 15 min, restore test hourly, against MinIO. No files job |
| Prod | backup every 3 h (RPO 3 h), restore test Sun and Wed 04:00, against S3 |

Override schedules with `BACKUP_CRON` and `RESTORE_TEST_CRON`.

## Keys

| Key | Where | Use |
| --- | --- | --- |
| Master secret | Offline, held by alpha | Disaster restore. Losing it makes every backup unreadable |
| Master public | `BACKUP_AGE_RECIPIENT` | Encrypts |
| Restore-test secret | `BACKUP_AGE_IDENTITY` | Unattended restore test. Cannot delete backups |
| Restore-test public | `BACKUP_AGE_RECIPIENT` | Encrypts |

Generate on a trusted machine, not the server:

```bash
age-keygen -o master.key        # keep offline
age-keygen -o restore-test.key  # secret goes in BACKUP_AGE_IDENTITY
```

## Setup

Env lives in `.env.<env>` ([example](../../backend/.env.example)).

| Var | Notes |
| --- | --- |
| `BACKUP_S3_BUCKET`, `BACKUP_S3_REGION` | Prod bucket and region |
| `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY` | Prod: IAM user below. Staging: MinIO root key. Vault `backup` set |
| `BACKUP_S3_ENDPOINT` | Set by compose to MinIO in staging. Unset in prod |
| `BACKUP_AGE_RECIPIENT` | Comma-separated age public keys (master, restore-test) |
| `BACKUP_AGE_IDENTITY` | Restore-test secret key. Unset: no restore test, alert fires |
| `BACKUP_PRUNE_DAYS` | Staging only. Delete date folders older than N days (default 1) |
| `BACKUP_MIN_BYTES` | Smaller dump fails the run (default 1024) |

### S3 bucket (prod)

- Versioning on.
- Lifecycle rule: expire current objects under `zenflow/prod/` after 14 days, noncurrent after 7.
- IAM user: put, get and list on `zenflow/prod/*`. No delete.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": ["s3:PutObject", "s3:GetObject"],
      "Resource": "arn:aws:s3:::<bucket>/zenflow/prod/*" },
    { "Effect": "Allow", "Action": "s3:ListBucket", "Resource": "arn:aws:s3:::<bucket>",
      "Condition": { "StringLike": { "s3:prefix": "zenflow/prod/*" } } }
  ]
}
```

A missing `GetObject` shows as a failed restore test.

## Operate

```bash
docker logs zenflow-backup-<env>
docker exec zenflow-backup-<env> sh -c '. /run/backup.env; sh /opt/backup/backup.sh'         # backup now
docker exec zenflow-backup-<env> sh -c '. /run/backup.env; sh /opt/backup/restore-test.sh'   # test now
docker exec zenflow-backup-prod sh -c '. /run/backup.env; sh /opt/backup/backup-files.sh'    # files now
```

Check Vault and files (prod):

```bash
docker logs zenflow-backup-prod 2>&1 | grep -iE 'vault|files'
aws s3 ls --recursive s3://<bucket>/zenflow/prod/ | grep -E 'vault-|/files/' | tail
```

The restore test also decrypts the newest Vault snapshot and fails if it is missing or empty.

## Not backed up

Redis, Prometheus, Loki, Tempo and Grafana state. See [migration.md](migration.md).

## Restore

```bash
aws s3 cp s3://<bucket>/zenflow/prod/<date>/zenflow-<ts>.dump.age .
age -d -i master.key -o zenflow.dump zenflow-<ts>.dump.age
pg_restore --no-owner --clean --if-exists -d <db> zenflow.dump
```

**Vault:** decrypt `vault-<ts>.tar.age`, untar into an empty `vault_data` volume, start Vault, unseal with 3 of 5 shares ([vault.md](vault.md)).

**Files:** stop `storage`, then:

```bash
aws s3 cp s3://<bucket>/zenflow/prod/files/<date>/files-<ts>.tar.age .
age -d -i master.key files-<ts>.tar.age | docker run --rm -i -v zenflow-prod_storage_data:/data alpine tar -xf - -C /data
```

Volume names carry the project prefix (`docker volume ls`). New machine: [migration.md](migration.md).

## Monitoring

Metrics go to a textfile volume, served by node-exporter.

| Metric | Meaning |
| --- | --- |
| `zenflow_backup_last_success_timestamp_seconds` | Last good backup |
| `zenflow_backup_last_size_bytes` | Last dump size |
| `zenflow_backup_restore_last_success_timestamp_seconds` | Last good restore test |
| `zenflow_backup_last_run_ok`, `zenflow_backup_restore_last_run_ok`, `zenflow_backup_files_last_run_ok` | 1 ok, 0 failed |
| `zenflow_backup_vault_last_success_timestamp_seconds` | Last Vault snapshot (prod) |
| `zenflow_backup_files_last_success_timestamp_seconds`, `zenflow_backup_files_last_size_bytes` | Last files archive and size (prod) |
| `zenflow_backup_last_run_timestamp_seconds`, `zenflow_backup_restore_last_run_timestamp_seconds` | Last run end, any result |

Dashboard: **Zenflow Backups** (`observability/grafana/dashboards/zenflow-backups.json`). Failures log `ERROR <job> failed (exit N) during: <step>` (`record_run` in `ops/backup/lib.sh`). "No data" on a prod Vault or files stat means that job never succeeded: read "Backup output".

### Alert rules

[`backup.yml`](../../backend/observability/grafana/provisioning/alerting/backup.yml). Missing data alerts.

| Rule | Fires when |
| --- | --- |
| Backup failed | `*_last_run_ok` is 0 |
| Restore test failed | `*_last_run_ok` is 0 |
| No backup | None in 7 h |
| Small dump | Under half the 7-day average |
| No restore test | None in 5 days |
| No Vault snapshot (prod) | None in 7 h |
| No files archive (prod) | None in 36 h |
| Files run failed (prod) | `zenflow_backup_files_last_run_ok` is 0 |

Before the first success, age counts from container start.

### Delivery

Contact point `zenflow-ops-email` (`alerting/contact-points.yml`) is the default policy, repeating every 4 h.

| Env | Delivery |
| --- | --- |
| Staging | Grafana to Mailpit (<http://localhost:8025>) |
| Prod | Mailgun SMTP from `alerts@usezenflow.com` |

Prod Mailgun setup:
1. Verify the `usezenflow.com` sending domain ([domains.md](domains.md#mail)).
2. Create the SMTP password for `postmaster@usezenflow.com`.
3. Set `GF_SMTP_PASSWORD` in Vault `grafana`. Host is `smtp.mailgun.org:587` in `compose.prod.yml`.
4. Deploy, then Grafana > Alerting > Contact points > Test.

Without the password, alerts fire but no mail leaves.

## Rotation

- S3 keys: rotate in IAM or MinIO, update `.env.<env>`, `docker compose up -d backup`.
- age keys: add the new public key to `BACKUP_AGE_RECIPIENT`. Keep the old secret key until old dumps expire.

## Tests

`pnpm --filter backend test:e2e` ([spec](../../backend/test/backup/backup.e2e-spec.ts)) boots Postgres, MinIO and the real `backup` service. Needs Docker.

Run alone: `pnpm --filter backend exec jest --config ./test/jest-e2e.json backup`.
