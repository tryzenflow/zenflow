# Vault (production secrets)

For operators. Self-hosted Vault: KV v2 plus AppRole. Part of [secrets.md](secrets.md) (issue #76).

## Scope

- Prod only. The `vault` service is in `backend/compose.prod.yml`; staging uses `.env.staging`.
- `SECRETS_PROVIDER=vault` is valid only for the `production` Environment. `deploy.sh` exits 2 and `deploy.yml` fails otherwise.
- Not implemented: dynamic DB credentials, transit engine, key rotation job, auto-unseal, HA.
- Files in `backend/ops/vault/`: `config.hcl`, `policy.hcl`, `setup-approle.sh`, `render-secrets.sh`, `import-dotenv.sh`.
- The `hashicorp/vault` image is pinned in `compose.prod.yml`.

## Layout

| Item | Value |
| --- | --- |
| KV mount | v2 at `secret/` |
| Secret sets | `secret/zenflow/<env>/<set>`, one per consumer: `api` (Nest roles and `migrations`), `bandit`, `postgres`, `minio`, `grafana`, `backup`, `session-redis`, `redis-ratelimit`, `redis-queue`, `redis-killswitch`, `redis-pubsub` |
| Keys | Secrets only, named by env var. Hosts, ports, users and bucket names live in `backend/env/prod.env` |
| Shared keys | Written to every set that needs them: `POSTGRES_PASSWORD` (`api`, `postgres`, `backup`), `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` (`api`, `minio`), `BANDIT_SERVICE_TOKEN` (`api`, `bandit`), each `*_REDIS_PASSWORD` (`api` and its own set) |
| Policy `zenflow-api-<env>` | `read` on each set path, listed explicitly. A new set needs a line in `policy.hcl` and a re-run of `setup-approle.sh` |
| AppRole `zenflow-api-<env>` | Token TTL 10 min (max 30), `secret_id` valid 30 days |
| Rendered files | `/run/zenflow/<env>/<set>/` on host tmpfs: one file per key plus `files.env` |
| API and Bandit | `files.env` holds `FOO_FILE=/run/secrets/zenflow/FOO`, mounted read-only |
| Postgres, MinIO, Grafana, backup | Own `files.env` with direct values, injected only into that service |

- `render-secrets.sh` logs in and writes the files. `file-secrets.ts` and `docker-entrypoint.sh` read them.
- Non-secret settings are the committed `backend/env/prod.env`, shipped as `.env.prod` (600). A key in both aborts the deploy.
- The app builds connections from parts (`DB_HOST`, `POSTGRES_*`, ...), so each password exists once.

## Test the render script

No Vault in the dev stack. CI uses a throwaway dev server:

```bash
docker run -d --name vault-smoke --cap-add IPC_LOCK -e VAULT_DEV_ROOT_TOKEN_ID=local-root \
  -p 127.0.0.1:8200:8200 hashicorp/vault:1.20.4 server -dev -dev-listen-address=0.0.0.0:8200
# put secret/zenflow/dev/{api,bandit}, run setup-approle.sh with ENV_NAME=dev, then render-secrets.sh
docker rm -f vault-smoke
```

## First-time init and unseal

Vault uses file storage on `vault_data`, listens on `127.0.0.1:8200` only, and always starts sealed.

1. Start it: `docker compose -f compose.prod.yml up -d vault`.
2. Initialise (5 shares, threshold 3). Save the output only in the password managers below.
   ```bash
   docker exec zenflow-vault-prod vault operator init -key-shares=5 -key-threshold=3
   ```
3. Three holders each run `docker exec -it zenflow-vault-prod vault operator unseal`.
4. With the root token (`VAULT_TOKEN`), enable KV, load secrets, create the AppRole:
   ```bash
   V="docker exec -e VAULT_TOKEN zenflow-vault-prod vault"
   $V secrets enable -path=secret -version=2 kv
   # Secrets only. Read values from a prompt or file, not shell history.
   $V kv put -mount=secret zenflow/prod/api SESSION_SECRET=... FILE_URL_SECRET=... MASTER_LMS_ENCRYPTION_KEY_V1=... MASTER_PORTAL_ENCRYPTION_KEY_V1=... POSTGRES_PASSWORD=... MAIL_PASSWORD=... S3_ACCESS_KEY_ID=... S3_SECRET_ACCESS_KEY=... PORTAL_API_KEY=... BANDIT_SERVICE_TOKEN=...
   $V kv put -mount=secret zenflow/prod/bandit BANDIT_SERVICE_TOKEN=...
   $V kv put -mount=secret zenflow/prod/postgres POSTGRES_PASSWORD=...
   $V kv put -mount=secret zenflow/prod/minio S3_ACCESS_KEY_ID=... S3_SECRET_ACCESS_KEY=...
   $V kv put -mount=secret zenflow/prod/grafana GF_SECURITY_ADMIN_PASSWORD=... GF_SMTP_PASSWORD=...
   $V kv put -mount=secret zenflow/prod/backup POSTGRES_PASSWORD=... BACKUP_S3_ACCESS_KEY_ID=... BACKUP_S3_SECRET_ACCESS_KEY=... BACKUP_AGE_IDENTITY=...
   # One Redis password each (openssl rand -hex 24), in `api` and in the instance's own set
   $V kv patch -mount=secret zenflow/prod/api SESSION_REDIS_PASSWORD=... RATE_LIMIT_REDIS_PASSWORD=... QUEUE_REDIS_PASSWORD=... REDIS_KILLSWITCH_PASSWORD=... REDIS_PUBSUB_PASSWORD=...
   $V kv put -mount=secret zenflow/prod/session-redis SESSION_REDIS_PASSWORD=...
   $V kv put -mount=secret zenflow/prod/redis-ratelimit RATE_LIMIT_REDIS_PASSWORD=...
   $V kv put -mount=secret zenflow/prod/redis-queue QUEUE_REDIS_PASSWORD=...
   $V kv put -mount=secret zenflow/prod/redis-killswitch REDIS_KILLSWITCH_PASSWORD=...
   $V kv put -mount=secret zenflow/prod/redis-pubsub REDIS_PUBSUB_PASSWORD=...
   sudo install -d -m 700 /etc/zenflow/vault
   docker run --rm --network container:zenflow-vault-prod -v $PWD/backend/ops/vault:/ops:ro \
     -v /etc/zenflow/vault:/creds -e VAULT_ADDR=http://127.0.0.1:8200 -e VAULT_TOKEN -e ENV_NAME=prod \
     hashicorp/vault:1.20.4 /ops/setup-approle.sh --role-id-file /creds/role_id --secret-id-file /creds/secret_id
   ```
   Or import an existing `.env.prod` in parts format. The importer writes each secret to every set that needs it and rejects unknown keys (Grafana uses `GF_SECURITY_ADMIN_PASSWORD` and `GF_SMTP_PASSWORD`):
   ```bash
   export VAULT_ADDR=http://127.0.0.1:8200 VAULT_ENV=prod
   read -rs -p "Vault root token: " VAULT_TOKEN && export VAULT_TOKEN
   ./ops/vault/import-dotenv.sh .env.prod --dry-run
   ./ops/vault/import-dotenv.sh .env.prod
   unset VAULT_TOKEN
   ```
5. Revoke the root token: `vault token revoke -self`. Use `vault operator generate-root` for policy changes or a new environment.
6. Set `SECRETS_PROVIDER=vault` on the GitHub Environment and deploy.
   - Move non-secret settings into `backend/env/prod.env` via PR and replace every `REPLACE_ME`.
   - The deploy ships it as `.env.prod`, renders the sets, and aborts on duplicate keys.
   - A sealed Vault (503) or uninitialised one (501) fails with a clear message.
7. Check `docker compose -f compose.prod.yml ps` is healthy. Securely delete any old `.env.prod` that held secrets.

### Move from `api` + `platform` to one set per consumer

Done once by the root-token holder:

1. Rewrite the old `.env.prod` as parts (`DB_HOST`, `POSTGRES_*`, `MAIL_*`, `*_HOST`, `BACKUP_S3_*`). No URL vars, no Redis `*_PASSWORD`.
2. Re-run `setup-approle.sh`.
3. Run `import-dotenv.sh .env.prod --dry-run`, then for real. Old KV versions stay.
4. Copy non-secret keys to `backend/env/prod.env`, merge, deploy.
5. When healthy: `vault kv metadata delete -mount=secret zenflow/prod/platform`.

### Turn on Redis passwords on a running stack

The deploy restarts every Redis with `requirepass` before the new colour starts. Sessions, OTP, rate limits, queues and SSE fail until the flip. Do it off-peak.

1. Write five passwords to `api` and each own set.
2. Re-run `setup-approle.sh`.
3. Deploy. Check `docker compose ps` and that `docker exec zenflow-redis-session-prod redis-cli ping` answers `NOAUTH`.

### After a restart or reboot

- Vault is sealed. Deploys fail until three holders unseal.
- Running apps keep working (they read files at boot only).
- A host reboot clears `/run` (tmpfs), so restarted containers cannot start. Unseal, then redeploy or run `render-secrets.sh`.

## Key shares

Review quarterly.

- No one holds 3 shares.
- Store shares in separate password managers. Never in the repo, CI, chat or deploy host.
- Do not store the root token.
- Losing more than `shares - threshold` shares makes data unrecoverable.
- Single maintainer: use 2 of 3 held by two people.
- Auto-unseal (KMS or Transit) is not configured.

| Share | Holder | Stored in | Reviewed |
| --- | --- | --- | --- |
| 1 | _name (owner)_ | _personal password manager_ | _date_ |
| 2 | _name (second maintainer)_ | _personal password manager_ | _date_ |
| 3 | _name_ | _personal password manager_ | _date_ |
| 4 | _name_ | _offline envelope or hardware token_ | _date_ |
| 5 | _name_ | _offline envelope or hardware token_ | _date_ |

## Deploy user

`DEPLOY_USER` must own the AppRole creds and `/run/zenflow`, and run docker. `deploy.sh` checks both. One-time, as root:

```bash
chown <user> /etc/zenflow/vault/role_id /etc/zenflow/vault/secret_id
echo 'd /run/zenflow 0700 <user> <user>' > /etc/tmpfiles.d/zenflow.conf
systemd-tmpfiles --create
```

## Rotate AppRole credentials

`secret_id` (`/etc/zenflow/vault/secret_id`, 600) expires in 30 days. Rotate monthly, or at once on exposure.

1. With a root or admin token: `ENV_NAME=prod ... setup-approle.sh --secret-id-file /creds/secret_id.new`. Old ids stay valid until expiry.
2. On the host, `mv` the new file over `/etc/zenflow/vault/secret_id` (600).
3. Deploy or run `render-secrets.sh` to confirm login.
4. On suspected exposure, list accessors with `vault list auth/approle/role/zenflow-api-prod/secret-id` and destroy the old one:
   ```bash
   vault write auth/approle/role/zenflow-api-prod/secret-id-accessor/destroy secret_id_accessor=<accessor>
   ```
5. Rotate `role_id`: `vault write auth/approle/role/zenflow-api-prod/role-id role_id=$(uuidgen)`, then `setup-approle.sh --role-id-file`.

## Backup and restore

`vault_data` is useless without 3 shares, but keep copies encrypted and off the host. The automated job is in [backups.md](backups.md). Manual copy (volume name: `docker volume ls`):

```bash
# backup (stop Vault briefly for consistent files)
docker compose -f compose.prod.yml stop vault
docker run --rm -v zenflow-prod_vault_data:/v:ro -v "$PWD":/out alpine tar czf /out/vault-$(date +%F).tgz -C /v .
docker compose -f compose.prod.yml start vault        # then unseal
# restore (empty volume, Vault stopped)
docker compose -f compose.prod.yml stop vault
docker run --rm -v zenflow-prod_vault_data:/v -v "$PWD":/in alpine sh -c 'rm -rf /v/* && tar xzf /in/vault-YYYY-MM-DD.tgz -C /v'
docker compose -f compose.prod.yml start vault        # unseal with the SAME shares
```

- Restore needs the shares current at backup time.
- A fresh, uninitialised Vault is not a restore: re-run `operator init` and reload every secret.

## Rotation with Vault

[secrets.md](secrets.md#rotation-runbooks) applies. "Update the store" is `vault kv patch -mount=secret zenflow/prod/api KEY=...` (`vault kv rollback` undoes it). "Deploy" re-renders and recreates containers.

| Secret | Vault specifics |
| --- | --- |
| `SESSION_SECRET` | Patch, deploy. All users log out |
| Redis password | Patch `api` and the instance's set, deploy. Brief outage, see [secrets.md](secrets.md#redis-passwords) |
| Database password | Run `ALTER USER`, patch `POSTGRES_PASSWORD` in `api`, `postgres` and `backup`, deploy |
| Crypto master keys | Patch in `MASTER_*_ENCRYPTION_KEY_V2`, set `MASTER_KEY_CURRENT_VERSION=2` in `backend/env/prod.env`, deploy |

Never `kv put` over a set that holds V1 keys: it replaces all keys, and V1 must stay while rows reference it.
