# Full backup and moving to another machine

For operators. What to keep so the stack can be rebuilt on a new VPS, and the order to do it. Day-to-day Postgres/Vault/files backups: [backups.md](backups.md).

> **Not yet rehearsed.** Commands are checked against the compose files and the other ops docs, but the whole runbook has not been run on a spare VPS. Do the [drill](#restore-drill) once before you need it.

## Short answer

Do **not** copy raw Docker volumes of a running Postgres: the files are only consistent after a crash-safe shutdown. State lives in four places, and everything else is rebuilt by a deploy:

| Where | What | Kept by |
| --- | --- | --- |
| Git | code, compose, nginx, Grafana dashboards and alerts | GitHub |
| Vault | every secret | snapshot with each dump, plus 3 of 5 unseal shares held offline |
| Postgres | users, sessions, reminders, schedules, everything relational | age-encrypted dump every 3 h |
| Uploaded files | note attachments (MinIO) | age-encrypted tar daily |

Also needed, never on the server: the age **master key** (decrypts every backup), the Vault **unseal shares**, and the GitHub Environment secrets (`DEPLOY_SSH_KEY` etc.).

## What each volume holds

Compose project `zenflow-prod`, so volumes are `zenflow-prod_<name>`.

| Volume | Holds | Backed up? | If lost |
| --- | --- | --- | --- |
| `postgres_data` | the database | Yes: dump to S3 every 3 h | restore the dump (up to 3 h of data lost) |
| `storage_data` | uploaded files | Yes: daily archive to S3 | restore the archive (up to 1 day lost) |
| `vault_data` | encrypted secrets | Yes: snapshot with each dump | restore, then unseal; or rebuild every secret by hand |
| `redis_queue_data` | BullMQ jobs | No | refills itself: see below |
| `redis_data` (sessions) | login sessions, OTPs | No | everyone logs in again |
| `redis_ratelimit_data` | rate-limit counters | No | disposable |
| `redis_killswitch_data` | feature flags | No | defaults apply; re-set flags ([kill-switch.md](kill-switch.md)) |
| `letsencrypt`, `certbot_webroot` | TLS certificates | No | re-issue, or copy the volume (step 7) |
| `grafana_data` | Grafana users, preferences | No | dashboards and alerts are provisioned from Git; re-create users |
| `prometheus_data`, `loki_data`, `tempo_data`, `alloy_data` | telemetry (logs kept ~7 days) | No | history is gone, nothing else |
| `backup_metrics` | backup gauges | No | rewritten by the next run |

Host files, not in any volume: `/etc/zenflow/vault/{role_id,secret_id}` (the AppRole login; the `secret_id` expires monthly and is re-issued, see [vault.md](vault.md#approle-credential-rotation)), `/run/zenflow` (tmpfs, re-rendered by every deploy), `$DEPLOY_PATH/backend/state/` and `.env.prod` (both written by deploy).

### Reminders and the queue: nothing to restore

Reminders are rows in Postgres (`SessionReminder`, with `firedForStart` marking what already fired). The queue only holds delayed copies. The watcher re-arms them from the database at boot and every minute, and a worker re-reads the row before sending, so an empty or stale queue cannot lose or double-send a reminder. The boot log says `armed N reminder job(s) from the database at boot`. Only reminders that came due during the outage and are more than about 6 minutes late are skipped, on purpose. Ingestion schedules are database rows too.

## Move to a new VPS

Plan for a quiet hour. Keep the old host untouched until the end.

1. **Prepare the new host**: Docker, firewall and non-root users per [server-access.md](server-access.md). Clone the repo into `$DEPLOY_PATH` (the deploy expects `backend/` there).
2. **Lower DNS TTL** for `zenflow.alphatrann.com` (and the Grafana/MinIO hosts) a day ahead.
3. **Last backups on the old host**: stop Vault briefly for a consistent copy (the cron snapshot is taken while it runs), then run the jobs by hand:
   ```bash
   cd $DEPLOY_PATH/backend
   docker compose -f compose.prod.yml stop vault
   docker exec zenflow-backup-prod sh -c '. /run/backup.env; sh /opt/backup/backup.sh; sh /opt/backup/backup-files.sh'
   docker compose -f compose.prod.yml start vault      # then unseal (3 shares)
   ```
   Writes after this are lost, so for a lower loss stop the writers first: `docker compose -f compose.prod.yml stop api-blue api-green watcher worker-portal worker-lms worker-notify`.
4. **Fetch the three objects** from S3 on a trusted machine (newest `.dump.age`, `vault-*.tar.age`, `files/**/files-*.tar.age`) and decrypt with the master key:
   ```bash
   age -d -i master.key -o zenflow.dump  zenflow-<ts>.dump.age
   age -d -i master.key -o vault.tar     vault-<ts>.tar.age
   age -d -i master.key -o files.tar     files-<ts>.tar.age
   ```
5. **Restore Vault** on the new host into an empty volume, start it and unseal with 3 shares ([vault.md](vault.md#backup-and-restore); the volume starts out empty, so create it with `docker volume create zenflow-prod_vault_data`):
   ```bash
   docker run --rm -i -v zenflow-prod_vault_data:/v alpine tar -xf - -C /v < vault.tar
   docker compose -f compose.prod.yml up -d vault      # then: docker exec -it zenflow-vault-prod vault operator unseal  (x3)
   ```
   Then create fresh AppRole credentials on the new host (`/etc/zenflow/vault/{role_id,secret_id}`, owned by the deploy user): [vault.md](vault.md#approle-credential-rotation).
6. **Deploy** with the GitHub Environment pointing at the new host (`DEPLOY_HOST`; add its key to `DEPLOY_KNOWN_HOSTS`). This brings up every service with an empty database and files volume and runs the migrations.
7. **TLS**: either copy the old certificates (`docker run --rm -v zenflow-prod_letsencrypt:/l alpine tar -cf - -C /l . | ssh newhost 'docker run --rm -i -v zenflow-prod_letsencrypt:/l alpine tar -xf - -C /l'`; they contain private keys, so ssh only) so HTTPS works before DNS moves, or point DNS first and run `backend/nginx/init-cert.sh` per host (Let's Encrypt limits repeated issuance).
8. **Load the data** with the writers stopped:
   ```bash
   export ZENFLOW_SECRETS_DIR=/run/zenflow/prod
   docker compose --env-file .env.prod -f compose.prod.yml stop api-blue api-green watcher worker-portal worker-lms worker-notify storage
   docker exec -i zenflow-db-prod sh -c 'pg_restore --no-owner --clean --if-exists -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < zenflow.dump
   docker run --rm -i -v zenflow-prod_storage_data:/data alpine sh -c 'rm -rf /data/* /data/.[!.]* ; tar -xf - -C /data' < files.tar
   docker compose --env-file .env.prod -f compose.prod.yml up -d storage
   ```
   Then start the stopped services again (or re-run the deploy).
9. **Check**: `docker compose ps` healthy; sign in; open a note with an attachment; the watcher log shows the reminder line; Grafana **Zenflow · Backups** turns green after the next run (the first cron backup on the new host proves S3 access).
10. **Switch DNS**. Keep the old host stopped (not deleted) for a week. Rotate anything that was ever on a machine you are retiring.

## Restore drill

Quarterly, on a scratch VPS or a throwaway compose project: run steps 4 to 9 from the latest S3 objects using the master key, then delete it. Record what broke here and fix this page. The automated restore test only proves the dump and the Vault archive decrypt ([backups.md](backups.md)); it does not prove the rest.

## Not covered

Backups of the S3 bucket itself, a standby database, and a second holder of the age master key are open decisions, not implemented. Losing the master key makes every backup unreadable.
