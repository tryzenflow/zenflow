# Vault (production secret store)

For operators. Self-hosted Vault container: KV v2 plus AppRole. Part of the secrets setup in [secrets.md](secrets.md) (issue #76).

## Scope

- Vault is **production-only**. The `vault` service exists only in `backend/compose.prod.yml`; staging secrets come from `.env.staging`.
- `SECRETS_PROVIDER=vault` is valid only for the `production` Environment; `deploy.sh` exits 2 and `deploy.yml` fails otherwise.
- Dev and staging read `.env.<env>` via `host`, `sops` or `command`; `FOO_FILE` support is unchanged.
- MVP-minimum: KV v2 with least-privilege AppRole replaces production `.env.prod`.
- **Not implemented (post-MVP, issue #76 "full Vault"):** dynamic DB credentials, transit engine, automated key rotation, auto-unseal, HA/Raft.

Files in `backend/ops/vault/`: `config.hcl` (server), `policy.hcl` (read-only), `setup-approle.sh`, `render-secrets.sh`.
Image `hashicorp/vault` is pinned in `compose.prod.yml`; bump deliberately (Dependabot's Docker ecosystem tracks it).

## Layout

| Item | Value |
| --- | --- |
| KV mount | v2 at `secret/` |
| Secret sets | one per consumer, `secret/zenflow/<env>/<set>`: `api` (Nest app: `api`, `watcher`, `worker-*`, `migrations`), `bandit`, `postgres`, `minio`, `grafana`, `backup` |
| Keys | secrets only, by env var name (`SESSION_SECRET`, `POSTGRES_PASSWORD`, `MASTER_LMS_ENCRYPTION_KEY_V1`, ...). Hosts, ports, usernames and bucket names are not secrets and live in `backend/env/prod.env` |
| Shared keys | written to every set that needs them: `POSTGRES_PASSWORD` (`api`, `postgres`, `backup`), `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` (`api`, `minio`), `BANDIT_SERVICE_TOKEN` (`api`, `bandit`) |
| Policy `zenflow-api-<env>` | `read` on each set's `secret/data/zenflow/<env>/<set>` path, listed explicitly; no wildcard, list, write or other environments. A new set needs a line in `policy.hcl` and a re-run of `setup-approle.sh` |
| AppRole `zenflow-api-<env>` | token TTL 10 min (max 30), `secret_id` valid 30 days |
| Rendered files | `/run/zenflow/<env>/<set>/` on the host tmpfs: one file per key plus `files.env` |
| API and Bandit delivery | `files.env` has `FOO_FILE=/run/secrets/zenflow/FOO`; the Nest roles and `migrations` mount `api`, Bandit mounts `bandit`, read-only |
| Third-party delivery | `postgres`, `minio`, `grafana` and `backup` each get their own `files.env` with direct values (those images have no `FOO_FILE` support), injected only into that service |

- `render-secrets.sh` logs in with the AppRole and writes the files; `file-secrets.ts` and `docker-entrypoint.sh` consume them.
- Bandit reuses `docker-entrypoint.sh` (bind-mounted, entrypoint override in compose) because it reads plain env vars only.
- Non-secret settings are the committed `backend/env/prod.env`, which `deploy.sh` ships as `.env.prod` (600). Only secrets are in Vault. A key in both aborts the deploy: a plain `KEY` would beat the rendered `KEY_FILE` and silently ignore Vault.
- The app composes its connections from parts (`DB_HOST`, `POSTGRES_*`, `SESSION_REDIS_HOST`, `MAIL_HOST`, ...), so a password exists once instead of inside a URL.
- Plain-env sets are still exposed as container environment variables because the upstream images do not consistently support `FOO_FILE`. They are rendered only on host tmpfs.

## Test the render script locally

No Vault in the dev compose stack. Run a throwaway dev-mode server (CI does the same):

```bash
docker run -d --name vault-smoke --cap-add IPC_LOCK -e VAULT_DEV_ROOT_TOKEN_ID=local-root \
  -p 127.0.0.1:8200:8200 hashicorp/vault:1.20.4 server -dev -dev-listen-address=0.0.0.0:8200
# put secret/zenflow/dev/{api,bandit}, run ops/setup-approle.sh with ENV_NAME=dev, then render-secrets.sh
docker rm -f vault-smoke
```

`.secrets-rendered/` is gitignored.

## First-time init and unseal

The service uses file storage on volume `vault_data`, `IPC_LOCK`, no UI, and a plain-HTTP listener on `127.0.0.1:8200` only.
Its healthcheck treats sealed or uninitialised as "process up" (`sealedcode=200&uninitcode=200`). It always starts **sealed**.

1. Start only Vault: `docker compose -f compose.prod.yml up -d vault`.
2. Initialise on the host (5 shares, threshold 3). Save the output only into the password managers below.
   ```bash
   docker exec zenflow-vault-prod vault operator init -key-shares=5 -key-threshold=3
   ```
3. Unseal with three different shares, each holder entering theirs: `docker exec -it zenflow-vault-prod vault operator unseal` (x3).
4. With the initial root token (`VAULT_TOKEN`), enable KV, load secrets, create the policy, AppRole and host credentials:
   ```bash
   V="docker exec -e VAULT_TOKEN zenflow-vault-prod vault"
   $V secrets enable -path=secret -version=2 kv
   # Copy every API value from the old .env.prod into this set before removing that file.
   # Secrets only (hosts, users, bucket names are in backend/env/prod.env). Read values from a prompt/file, not shell history.
   $V kv put -mount=secret zenflow/prod/api SESSION_SECRET=... FILE_URL_SECRET=... MASTER_LMS_ENCRYPTION_KEY_V1=... MASTER_PORTAL_ENCRYPTION_KEY_V1=... POSTGRES_PASSWORD=... MAIL_PASSWORD=... S3_ACCESS_KEY_ID=... S3_SECRET_ACCESS_KEY=... PORTAL_API_KEY=... BANDIT_SERVICE_TOKEN=...
   $V kv put -mount=secret zenflow/prod/bandit BANDIT_SERVICE_TOKEN=...
   $V kv put -mount=secret zenflow/prod/postgres POSTGRES_PASSWORD=...
   $V kv put -mount=secret zenflow/prod/minio S3_ACCESS_KEY_ID=... S3_SECRET_ACCESS_KEY=...
   $V kv put -mount=secret zenflow/prod/grafana GF_SECURITY_ADMIN_PASSWORD=... GF_SMTP_PASSWORD=...
   $V kv put -mount=secret zenflow/prod/backup POSTGRES_PASSWORD=... BACKUP_S3_ACCESS_KEY_ID=... BACKUP_S3_SECRET_ACCESS_KEY=... BACKUP_AGE_IDENTITY=...
   sudo install -d -m 700 /etc/zenflow/vault
   docker run --rm --network container:zenflow-vault-prod -v $PWD/backend/ops/vault:/ops:ro \
     -v /etc/zenflow/vault:/creds -e VAULT_ADDR=http://127.0.0.1:8200 -e VAULT_TOKEN -e ENV_NAME=prod \
     hashicorp/vault:1.20.4 /ops/setup-approle.sh --role-id-file /creds/role_id --secret-id-file /creds/secret_id
   ```
   If you already have a `.env.prod` in the new parts format, use the importer instead of retyping values. It writes each secret to every set that needs it, leaves non-secrets in the env file (listed in `--dry-run`), maps the old Grafana variable names, and **rejects** unknown keys, the removed URL vars and misnamed backup keys instead of guessing:
   ```bash
   export VAULT_ADDR=http://127.0.0.1:8200 VAULT_ENV=prod
   read -rs -p "Vault root token: " VAULT_TOKEN && export VAULT_TOKEN
   ./ops/vault/import-dotenv.sh .env.prod --dry-run  # prints names only
   ./ops/vault/import-dotenv.sh .env.prod
   unset VAULT_TOKEN
   ```
5. **Revoke the root token**: `vault token revoke -self`. Recreate one with `vault operator generate-root` (needs the shares) only for policy changes or a new environment.
6. Set `SECRETS_PROVIDER=vault` on the GitHub Environment and deploy. Put every non-secret setting from the old `.env.prod` into `backend/env/prod.env` (reviewed in a PR); keep a copy of the old file until the new containers are healthy.
   - The deploy ships `backend/env/prod.env` as `.env.prod`, starts Vault, renders the six sets, aborts if a key is in both, and starts services from those files. Replace every `REPLACE_ME` in `prod.env` first; the deploy refuses to ship it otherwise.
   - It fails with a clear message if Vault is sealed (HTTP 503) or uninitialised (501).
7. Verify `docker compose -f compose.prod.yml ps` is healthy. The `.env.prod` on the host is now the shipped non-secret file; securely delete any copy of the old one that held secrets.

### Moving an existing Vault from `api` + `platform` to one set per consumer

Done once, by the root-token holder (or `generate-root` with three shares):

1. Convert the old `.env.prod` to parts: drop `DATABASE_URL` and `MAIL_TRANSPORT`, add `DB_HOST`, `POSTGRES_*`, `MAIL_*`, `*_HOST`, and rename the backup keys to `BACKUP_S3_ACCESS_KEY_ID` / `BACKUP_S3_SECRET_ACCESS_KEY`. Remove unused `*_PASSWORD` Redis vars.
2. Re-run `setup-approle.sh` so the policy lists the new set paths.
3. `import-dotenv.sh .env.prod --dry-run`, then for real. Old KV versions stay, so nothing is lost.
4. Copy the non-secret keys into `backend/env/prod.env` and merge that PR, then deploy.
5. After the stack is healthy, delete the retired set and keys: `vault kv metadata delete -mount=secret zenflow/prod/platform`, and `vault kv patch` the `api` set without `DATABASE_URL` / `MAIL_TRANSPORT` (or `kv put` the full new `api` set).

### After a Vault restart or host reboot

- Vault is sealed; deploys fail until three share holders unseal it.
- Running apps keep working: they read the files at boot only.
- A restarted container cannot start without the rendered files, and `/run` is tmpfs, so a **host reboot clears them**.
- Unseal, then re-run the deploy (or `render-secrets.sh` by hand). Put this in the on-call runbook.

## Who holds the key shares

Fill in and review quarterly.

- No one person holds 3 shares.
- Shares live in different password managers or vaults; never the repo, CI, chat or the deploy host.
- The root token is not stored.

| Share | Holder | Stored in | Reviewed |
| --- | --- | --- | --- |
| 1 | _name (owner)_ | _personal password manager_ | _date_ |
| 2 | _name (second maintainer)_ | _personal password manager_ | _date_ |
| 3 | _name_ | _personal password manager_ | _date_ |
| 4 | _name_ | _offline/sealed envelope or hardware token_ | _date_ |
| 5 | _name_ | _offline/sealed envelope or hardware token_ | _date_ |

- With a single maintainer, use threshold 2 of 3 held by two separate people if possible.
- Losing more than `shares - threshold` shares makes the data unrecoverable (see backup).
- Auto-unseal via cloud KMS or Transit (`seal "awskms" { ... }` in `config.hcl`) is documented, **not configured**: no cloud account to bind to.
  It trades the human quorum for trust in the KMS IAM policy; migrate with `vault operator unseal -migrate`.

## Deploy user

`DEPLOY_USER` need not be root, but must be the owner of the AppRole creds and of `/run/zenflow`, and be able to run docker. `deploy.sh` checks both and fails with the fix. One-time, as root:

```bash
chown <user> /etc/zenflow/vault/role_id /etc/zenflow/vault/secret_id
echo 'd /run/zenflow 0700 <user> <user>' > /etc/tmpfiles.d/zenflow.conf   # /run is tmpfs: recreated each boot
systemd-tmpfiles --create
```

## AppRole credential rotation

`role_id` is an identifier. `secret_id` is the credential, in `/etc/zenflow/vault/secret_id` (600, owned by the deploy user) on the deploy host.
It expires after 30 days: rotate at least monthly, and at once if the host or file may be exposed.

1. With an admin or freshly generated root token: `ENV_NAME=prod ... setup-approle.sh --secret-id-file /creds/secret_id.new`. Old secret_ids stay valid until expiry, so there is no downtime.
2. On the host, `mv` the new file over `/etc/zenflow/vault/secret_id` (mode 600).
3. Run a deploy (or `render-secrets.sh`) and confirm the login works.
4. If exposure is suspected, revoke the old one. List accessors with `vault list auth/approle/role/zenflow-api-prod/secret-id`.
   ```bash
   vault write auth/approle/role/zenflow-api-prod/secret-id-accessor/destroy secret_id_accessor=<accessor>
   ```
5. To rotate `role_id`: `vault write auth/approle/role/zenflow-api-prod/role-id role_id=$(uuidgen)`, then re-run `setup-approle.sh --role-id-file`.

## Backup and restore

`vault_data` holds encrypted data, useless without 3 unseal shares. Keep backups encrypted and off the host anyway.
The volume is `<compose project>_vault_data` (e.g. `zenflow-prod_vault_data`; check `docker volume ls`).

```bash
# backup (file backend: stop Vault briefly for consistent files)
docker compose -f compose.prod.yml stop vault
docker run --rm -v zenflow-prod_vault_data:/v:ro -v "$PWD":/out alpine tar czf /out/vault-$(date +%F).tgz -C /v .
docker compose -f compose.prod.yml start vault        # then unseal
# restore (into an empty volume, Vault stopped)
docker compose -f compose.prod.yml stop vault
docker run --rm -v zenflow-prod_vault_data:/v -v "$PWD":/in alpine sh -c 'rm -rf /v/* && tar xzf /in/vault-YYYY-MM-DD.tgz -C /v'
docker compose -f compose.prod.yml start vault        # then unseal with the SAME shares
```

- Restore needs the shares that were current when the backup was taken.
- Test a restore on a scratch host before relying on it.
- A rebuilt, never-initialised Vault is not a restore: re-run `operator init` and reload every secret from its upstream source.

## Rotation with Vault

The runbooks in [secrets.md](secrets.md#rotation-runbooks) apply with two changes.
"Update the store" means `vault kv patch -mount=secret zenflow/prod/api KEY=...` (new KV version; `vault kv rollback` undoes a bad write).
"Deploy" re-renders and force-recreates the containers.

| Secret | Vault specifics |
| --- | --- |
| `SESSION_SECRET` | patch, deploy; all users are logged out |
| Database password | run the `ALTER USER` step, patch `POSTGRES_PASSWORD` in all three sets (`api`, `postgres`, `backup`), then deploy; dynamic DB credentials are post-MVP |
| Crypto master keys | add `MASTER_*_ENCRYPTION_KEY_V2` with `kv patch`, ship the code change, deploy |

- Never `kv put` over a set without V1: `kv put` replaces all keys, and V1 must stay while rows reference it.
- KV version history is not a substitute for the re-wrap job. Transit-engine key management is post-MVP.
