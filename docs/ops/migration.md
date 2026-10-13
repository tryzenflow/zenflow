# Full backup and moving machines

For operators. What to keep and the order to rebuild the stack on a new VPS. Routine backups: [backups.md](backups.md).

Not yet rehearsed on a spare VPS. Run the [drill](#restore-drill) before you need it.

Never copy raw volumes of a running Postgres. State lives in four places, and a deploy rebuilds the rest:

| Where | What | Kept by |
| --- | --- | --- |
| Git | Code, compose, nginx, Grafana dashboards and alerts | GitHub |
| Vault | Every secret | Snapshot with each dump, plus 3 of 5 offline shares |
| Postgres | All relational data | age dump every 3 h |
| Uploaded files | Note attachments (MinIO) | age tar daily |

Keep off the server: the age master key, the Vault unseal shares, and the GitHub Environment secrets.

## Volumes

Project `zenflow-prod`, so volumes are `zenflow-prod_<name>`.

| Volume | Holds | Backed up | If lost |
| --- | --- | --- | --- |
| `postgres_data` | Database | Dump every 3 h | Restore (up to 3 h lost) |
| `storage_data` | Uploaded files | Archive daily | Restore (up to 1 day lost) |
| `vault_data` | Encrypted secrets | Snapshot with each dump | Restore and unseal |
| `redis_queue_data` | BullMQ jobs | No | Refills itself |
| `redis_data` | Sessions, OTPs | No | Users log in again |
| `redis_ratelimit_data` | Counters | No | Disposable |
| `redis_killswitch_data` | Flags | No | Defaults apply. Re-set ([kill-switch.md](kill-switch.md)) |
| `letsencrypt`, `certbot_webroot` | TLS certificates | No | Re-issue or copy (step 7) |
| `grafana_data` | Users, preferences | No | Dashboards and alerts come from Git |
| `prometheus_data`, `loki_data`, `tempo_data`, `alloy_data` | Telemetry | No | History lost |
| `backup_metrics` | Backup gauges | No | Next run rewrites |

Host files outside volumes: `/etc/zenflow/vault/{role_id,secret_id}` ([vault.md](vault.md#rotate-approle-credentials)), `/run/zenflow` (re-rendered by deploy), `$DEPLOY_PATH/backend/state/` and `.env.prod` (written by deploy).

Reminders need no restore. They are Postgres rows, and the watcher re-arms the queue at boot and every minute. Only reminders over ~6 min late are skipped.

## Move to a new VPS

Keep the old host untouched until the end.

1. **Prepare the host.** Docker, firewall and users per [server-access.md](server-access.md). Clone the repo into `$DEPLOY_PATH`.
2. **Lower DNS TTL** for `zenflow.alphatrann.com` and the Grafana and MinIO hosts a day ahead.
3. **Take last backups** on the old host. Stop the writers first to lose less:
   ```bash
   cd $DEPLOY_PATH/backend
   docker compose -f compose.prod.yml stop api-blue api-green watcher worker-portal worker-lms worker-notify
   docker compose -f compose.prod.yml stop vault
   docker exec zenflow-backup-prod sh -c '. /run/backup.env; sh /opt/backup/backup.sh; sh /opt/backup/backup-files.sh'
   docker compose -f compose.prod.yml start vault      # then unseal (3 shares)
   ```
4. **Fetch and decrypt** the newest `.dump.age`, `vault-*.tar.age` and `files/**/files-*.tar.age` on a trusted machine:
   ```bash
   age -d -i master.key -o zenflow.dump  zenflow-<ts>.dump.age
   age -d -i master.key -o vault.tar     vault-<ts>.tar.age
   age -d -i master.key -o files.tar     files-<ts>.tar.age
   ```
5. **Restore Vault** on the new host, then unseal with 3 shares:
   ```bash
   docker volume create zenflow-prod_vault_data
   docker run --rm -i -v zenflow-prod_vault_data:/v alpine tar -xf - -C /v < vault.tar
   docker compose -f compose.prod.yml up -d vault      # then: docker exec -it zenflow-vault-prod vault operator unseal  (x3)
   ```
   Create new AppRole credentials ([vault.md](vault.md#rotate-approle-credentials)).
6. **Deploy** with the Environment pointing at the new host (`DEPLOY_HOST`, plus its key in `DEPLOY_KNOWN_HOSTS`). This starts every service with empty data and runs migrations.
7. **TLS.** Copy the old certificates over ssh (they hold private keys), or point DNS first and run `backend/nginx/init-cert.sh` per host:
   ```bash
   docker run --rm -v zenflow-prod_letsencrypt:/l alpine tar -cf - -C /l . | ssh newhost 'docker run --rm -i -v zenflow-prod_letsencrypt:/l alpine tar -xf - -C /l'
   ```
8. **Load data** with writers stopped:
   ```bash
   export ZENFLOW_SECRETS_DIR=/run/zenflow/prod
   docker compose --env-file .env.prod -f compose.prod.yml stop api-blue api-green watcher worker-portal worker-lms worker-notify storage
   docker exec -i zenflow-db-prod sh -c 'pg_restore --no-owner --clean --if-exists -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < zenflow.dump
   docker run --rm -i -v zenflow-prod_storage_data:/data alpine sh -c 'rm -rf /data/* /data/.[!.]* ; tar -xf - -C /data' < files.tar
   docker compose --env-file .env.prod -f compose.prod.yml up -d storage
   ```
   Restart the stopped services, or redeploy.
9. **Check.** `docker compose ps` is healthy, sign in, open a note with an attachment, the watcher logs `armed N reminder job(s) from the database at boot`, and **Zenflow Backups** turns green after the next run.
10. **Switch DNS.** Keep the old host stopped for a week. Rotate anything that was on a retired machine.

## Restore drill

Quarterly, on a scratch VPS or throwaway compose project: run steps 4 to 9 from the latest S3 objects, then delete it. Fix this page with what broke. The automated restore test covers only the dump and the Vault archive.

## Not covered

S3 bucket backups, a standby database, and a second holder of the age master key. Losing the master key makes every backup unreadable.
