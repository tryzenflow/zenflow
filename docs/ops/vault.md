# Vault (production secret store)

For operators. Self-hosted Vault container: KV v2 plus AppRole. Part of the secrets setup in [secrets.md](secrets.md) (issue #76).

## Scope

- Vault is **production-only**. The `vault` service exists only in `backend/compose.prod.yml`.
- `SECRETS_PROVIDER=vault` is valid only for the `production` Environment; `deploy.sh` exits 2 and `deploy.yml` fails otherwise.
- Dev and staging read `.env.<env>` via `host`, `sops` or `command`; `FOO_FILE` support is unchanged.
- MVP-minimum: KV v2 with least-privilege AppRole replaces plaintext `.env` secrets.
- **Not implemented (post-MVP, issue #76 "full Vault"):** dynamic DB credentials, transit engine, automated key rotation, auto-unseal, HA/Raft.

Files in `backend/ops/vault/`: `config.hcl` (server), `policy.hcl` (read-only), `setup-approle.sh`, `render-secrets.sh`.
Image `hashicorp/vault` is pinned in `compose.prod.yml`; bump deliberately (Dependabot's Docker ecosystem tracks it).

## Layout

| Item | Value |
| --- | --- |
| KV mount | v2 at `secret/` |
| Secret sets | `secret/zenflow/<env>/api` (`api`, `migrations`) and `secret/zenflow/<env>/bandit` |
| Keys | env var names (`SESSION_SECRET`, `DATABASE_URL`, `MASTER_LMS_ENCRYPTION_KEY_V1`, ...) |
| Shared key | `BANDIT_SERVICE_TOKEN` is stored in both sets |
| Policy `zenflow-api-<env>` | `read` on `secret/data/zenflow/<env>/*` only; no list, write or other environments |
| AppRole `zenflow-api-<env>` | token TTL 10 min (max 30), `secret_id` valid 30 days |
| Rendered files | `/run/zenflow/<env>/<set>/` on the host tmpfs: one file per key plus `files.env` (`FOO_FILE=/run/secrets/zenflow/FOO`) |
| Container mounts | `.../api` into `api` and `migrations`, `.../bandit` into `bandit`, at `/run/secrets/zenflow` read-only; `files.env` is an optional `env_file` |

- `render-secrets.sh` logs in with the AppRole and writes the files; `file-secrets.ts` and `docker-entrypoint.sh` consume them.
- Bandit reuses `docker-entrypoint.sh` (bind-mounted, entrypoint override in compose) because it reads plain env vars only.
- Still on `.env.<env>`: `POSTGRES_*` (the image supports `POSTGRES_PASSWORD_FILE`; wire it when needed), `S3_*` (MinIO root user), `GRAFANA_ADMIN_PASSWORD`.
- Remove a key from `.env.<env>` once Vault serves it: an explicit `FOO` beats `FOO_FILE`.

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

1. Deploy once with `SECRETS_PROVIDER=host`, or start only Vault: `docker compose -f compose.prod.yml up -d vault`.
2. Initialise on the host (5 shares, threshold 3). Save the output only into the password managers below.
   ```bash
   docker exec zenflow-vault-prod vault operator init -key-shares=5 -key-threshold=3
   ```
3. Unseal with three different shares, each holder entering theirs: `docker exec -it zenflow-vault-prod vault operator unseal` (x3).
4. With the initial root token (`VAULT_TOKEN`), enable KV, load secrets, create the policy, AppRole and host credentials:
   ```bash
   V="docker exec -e VAULT_TOKEN zenflow-vault-prod vault"
   $V secrets enable -path=secret -version=2 kv
   $V kv put -mount=secret zenflow/prod/api DATABASE_URL=... SESSION_SECRET=... ...   # read values from a prompt/file, not shell history
   $V kv put -mount=secret zenflow/prod/bandit BANDIT_SERVICE_TOKEN=...
   sudo install -d -m 700 /etc/zenflow/vault
   docker run --rm --network container:zenflow-vault-prod -v $PWD/backend/ops/vault:/ops:ro \
     -v /etc/zenflow/vault:/creds -e VAULT_ADDR=http://127.0.0.1:8200 -e VAULT_TOKEN -e ENV_NAME=prod \
     hashicorp/vault:1.20.4 /ops/setup-approle.sh --role-id-file /creds/role_id --secret-id-file /creds/secret_id
   ```
5. **Revoke the root token**: `vault token revoke -self`. Recreate one with `vault operator generate-root` (needs the shares) only for policy changes or a new environment.
6. Set `SECRETS_PROVIDER=vault` on the GitHub Environment and deploy.
   - The deploy starts Vault, renders the files and force-recreates `api`, `migrations` and `bandit`.
   - It fails with a clear message if Vault is sealed (HTTP 503) or uninitialised (501).

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

## AppRole credential rotation

`role_id` is an identifier. `secret_id` is the credential, in `/etc/zenflow/vault/secret_id` (root-only, 600) on the deploy host.
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
| Database password | run the `ALTER USER` step, patch `DATABASE_URL`, deploy; `POSTGRES_PASSWORD` still lives in `.env.<env>`, update it too; dynamic DB credentials are post-MVP |
| Crypto master keys | add `MASTER_*_ENCRYPTION_KEY_V2` with `kv patch`, ship the code change, deploy |

- Never `kv put` over a set without V1: `kv put` replaces all keys, and V1 must stay while rows reference it.
- KV version history is not a substitute for the re-wrap job. Transit-engine key management is post-MVP.
