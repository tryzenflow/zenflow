# Postgres backups

For maintainers/operators (issue #137, [ADR-0014](../adr/0014-postgres-backups-to-s3.md)).

| Item | Value |
| --- | --- |
| Service | `backup` in `backend/compose.staging.yml` and `compose.prod.yml` (own `crond` process) |
| Scripts | `backend/ops/backup/` (`backup.sh`, `restore-test.sh`, `entrypoint.sh`) |
| Object | `s3://$BACKUP_S3_BUCKET/zenflow/<env>/YYYY/MM/DD/zenflow-<ts>.dump.age` (+ `vault-<ts>.tar.age`) |
| Format | `pg_dump -Fc`, encrypted with [age](https://age-encryption.org) |
| Schedule | staging: backup every 15 min, restore test hourly, against MinIO. Prod: backup every 3 h, restore test Sun 04:00, against S3. RPO is at most 3 h. Override with `BACKUP_CRON` / `RESTORE_TEST_CRON` |

## Key model

- An age keypair is a **public key** (encrypts, safe to share) and a **secret key** (decrypts, guard it).
- **Master keypair:** public key on the server (`BACKUP_AGE_RECIPIENT`), secret key offline with alpha. Only this can be trusted to restore in a disaster.
- **Restore-test keypair:** a second pair so the weekly test can decrypt unattended. Its public key is also in `BACKUP_AGE_RECIPIENT` (every dump is readable by either secret key); its secret key is `BACKUP_AGE_IDENTITY` on the server. It never replaces the master key.

## Setup

Env lives in `.env.<env>` (see `backend/.env.example`):

| Var | Notes |
| --- | --- |
| `BACKUP_S3_BUCKET`, `BACKUP_S3_REGION` | prod: the real bucket and its region |
| `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY` | prod: IAM user with put, list and get on `zenflow/prod/*` (no delete). Staging: the MinIO root key. Vault `backup` set |
| `BACKUP_S3_ENDPOINT` | set by compose to MinIO in staging; leave unset in prod (AWS) |
| `BACKUP_AGE_RECIPIENT` | age **public** keys, comma separated: the master key and the restore-test key |
| `BACKUP_AGE_IDENTITY` | the restore-test **secret** key. Unset = restore test is not scheduled and its alert fires |
| `BACKUP_PRUNE_DAYS` | staging only: delete objects whose date folder is older than N days (default 1). Never set in prod |
| `BACKUP_MIN_BYTES` | a smaller dump fails the run and records no success (default 1024) |

Generate keys on a trusted machine, not the server:

```bash
age-keygen -o master.key        # prints the public key; keep master.key offline
age-keygen -o restore-test.key  # secret goes in BACKUP_AGE_IDENTITY
```

### Who holds the master key

The age **master private key is held off the server** by: **alpha** (stored in a password manager, plus one offline copy; a second holder is recommended so one lost laptop is not fatal). Losing it makes every backup unreadable. The server only ever sees the public key and the restore-test key, which can decrypt backups but cannot delete them.

### S3 bucket (prod)

- Versioning on.
- Retention is by age, set as an S3 lifecycle rule (the IAM user cannot delete, so the container never prunes in prod): expire current objects under `zenflow/prod/` after **14 days** and noncurrent versions after 7. At 3-hourly that is about 112 objects.
- IAM user policy: `s3:PutObject`, `s3:GetObject`, `s3:ListBucket` on the bucket and `zenflow/prod/*` only. `GetObject` is what `restore-test.sh` needs to download the newest dump; the dumps are age-encrypted, so read access alone exposes nothing. No delete, so a compromised host cannot erase history.

## Operate

```bash
docker logs zenflow-backup-<env>                       # job output
docker exec zenflow-backup-<env> sh -c '. /run/backup.env; sh /opt/backup/backup.sh'        # run now
docker exec zenflow-backup-<env> sh -c '. /run/backup.env; sh /opt/backup/restore-test.sh'  # test now
```

## Restore

```bash
aws s3 cp s3://<bucket>/zenflow/prod/<date>/zenflow-<ts>.dump.age .
age -d -i master.key -o zenflow.dump zenflow-<ts>.dump.age
pg_restore --no-owner --clean --if-exists -d <db> zenflow.dump
```

Vault: decrypt `vault-<ts>.tar.age` the same way, untar into an empty `vault_data` volume, start Vault, unseal. The copy is taken while Vault runs; it is encrypted at rest by Vault's own seal.

## Monitoring

Metrics are written to a textfile volume and exposed by node-exporter:

| Metric | Meaning |
| --- | --- |
| `zenflow_backup_last_success_timestamp_seconds` | last good backup |
| `zenflow_backup_last_size_bytes` | size of the last dump |
| `zenflow_backup_restore_last_success_timestamp_seconds` | last good restore test |

Grafana rules (`backend/observability/grafana/provisioning/alerting/backup.yml`): no backup in 26 h, dump under 1 MiB, no restore test in 8 days. Missing data also alerts.

### Alerts

Contact point `zenflow-ops-email` (`alerting/contact-points.yml`) emails alphatran.forwork@gmail.com; it is the default policy, repeating every 4 h.

| Env | Delivery |
| --- | --- |
| Staging | Grafana (<http://grafana.localhost>) sends to Mailpit (<http://localhost:8025>) |
| Prod | Mailgun SMTP, sender domain `zenflow.alphatrann.com`, from `alerts@zenflow.alphatrann.com` |

Prod Mailgun setup (Grafana only speaks SMTP, not the Mailgun API):
1. Mailgun: add domain `zenflow.alphatrann.com`; publish the SPF and DKIM DNS records it shows and wait for "verified".
2. Domain settings > SMTP credentials: create/reset the password for `postmaster@zenflow.alphatrann.com`.
3. Vault `grafana` set: `GF_SMTP_PASSWORD=<that password>`. The configured host is `smtp.mailgun.org:587`; edit `compose.prod.yml` for a different Mailgun region or sender.
4. Deploy, then Grafana > Alerting > Contact points > Test, and check Mailgun logs.

Without the password alerts still fire in Grafana but no mail leaves. Gmail may route a new sender to spam at first; mark it as not spam.

## Rotation

- S3 keys: rotate in IAM/MinIO, update `.env.<env>`, `docker compose up -d backup`.
- age keys: add the new public key to `BACKUP_AGE_RECIPIENT`; old dumps stay readable only by old keys, so keep the old private key until those expire.

## Tests

`pnpm --filter backend test:e2e` ([spec](../../backend/test/backup/backup.e2e-spec.ts)): boots its own Postgres + MinIO and the real `backup` service with crond every minute, then checks the encrypted object, Vault snapshot, decrypt + data, restore test, failure paths (small dump, bad S3 key, bad DB, bad age key), pruning, and the metrics. Needs Docker; no other stack. Runs in the normal backend e2e CI job; alone: `pnpm --filter backend exec jest --config ./test/jest-e2e.json backup`.
