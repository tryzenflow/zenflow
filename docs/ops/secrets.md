# Secrets management

Issue #76. Minimum viable setup: secrets live in a managed store (or SOPS-encrypted files), are injected at deploy time, and never exist in the repo or in an image. A self-hosted Vault container (KV + AppRole) is included; dynamic DB credentials and transit encryption are post-MVP.

Rule of thumb: if it would hurt to see it in a screenshot, it is a secret and goes through this document.

## Inventory

Values are never listed here. "Where" is the runtime source; `.env.example` shows the shape.

| Secret | Used by | Where it lives | Rotation |
| --- | --- | --- | --- |
| `DATABASE_URL` (contains the DB password), `POSTGRES_PASSWORD` | API, migrations, Postgres container | store, injected into `.env.<env>` | runbook below |
| `SESSION_SECRET` | signs the session cookie (`express-session`). This app has **no JWT**; this is the equivalent signing key | store | runbook below |
| `MASTER_LMS_ENCRYPTION_KEY_V<n>`, `MASTER_PORTAL_ENCRYPTION_KEY_V<n>` | wrap per-user data-encryption keys that protect stored DLU/LMS credentials (`backend/src/crypto`) | store; NEVER only in the DB | runbook below |
| `PORTAL_API_KEY` | DLU portal API key (expires upstream, taken from a browser session) | store | replace when DLU invalidates it |
| `MAIL_TRANSPORT` | SMTP URL with credentials | store | rotate at the SMTP provider |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | file storage; also used as the MinIO root user/password in compose | store | rotate in MinIO/S3, redeploy |
| `BANDIT_SERVICE_TOKEN` | bearer for `POST /v1/place` (the Python side also accepts `BANDIT_SERVICE_TOKEN_PREVIOUS`, so rotation is zero-downtime) | store (both services) | set new on bandit with the old as `_PREVIOUS`, then API, then drop `_PREVIOUS` |
| `FCM_SERVICE_ACCOUNT`, `APNS_KEY` (+ `APNS_KEY_ID`, `APNS_TEAM_ID`) | push notifications | store | rotate in Firebase / Apple developer portal |
| `GRAFANA_ADMIN_PASSWORD` | Grafana (prod compose) | store | change and redeploy |
| `CACHE_URL`, `RATE_LIMIT_CACHE_URL` | Redis. Currently unauthenticated on internal-only Docker networks; add a password if that changes | n/a | n/a |
| Per-user DLU/LMS credentials | `Integration` rows in Postgres, encrypted under per-user DEKs | DB (ciphertext only) | by the user |
| `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`, `SOPS_AGE_KEY`, `SECRETS_COMMAND` | CI deploy | GitHub Environment secrets | rotate yearly or on offboarding |
| `GITHUB_TOKEN` | image push/pull | issued per workflow run | automatic |

Not secrets: `VITE_*` and `EXPO_PUBLIC_*` (shipped to clients), `backend/certs/lms-ca.pem` (public CA certificate), `CORS_ORIGIN`, URLs without credentials.

## How secrets reach the app

The app reads everything through `ConfigService`/`process.env`; `ConfigModule` never overrides an existing environment variable, and the image contains no env files (`.dockerignore` excludes `**/*.env*`; CI checks the built image). Two supported ways to inject:

1. **Environment variables** supplied by the platform (compose `env_file`, ECS/K8s secret refs).
2. **`*_FILE` variants** (Docker/Swarm/K8s secret mounts, Vault Agent, SOPS to tmpfs): set `DATABASE_URL_FILE=/run/secrets/database_url` and the value is read from the file. Works for any variable (`SESSION_SECRET_FILE`, `MASTER_LMS_ENCRYPTION_KEY_V1_FILE`, ...). An explicit `FOO` wins over `FOO_FILE`; one trailing newline is stripped; an unreadable file aborts boot. Implemented in `backend/src/common/config/file-secrets.ts` (imported first in `main.ts`) and `backend/docker-entrypoint.sh` (needed by the Prisma CLI in the `migrations` service). Not yet used by the bandit service (it only reads env vars).

### Deploy-time injection (`scripts/deploy/deploy.sh`, `SECRETS_PROVIDER`)

| Provider | How | Use when |
| --- | --- | --- |
| `host` (default) | `backend/.env.<env>` already exists on the host, written by your platform/secret manager agent | Vault Agent, cloud secret manager sidecar/cron, manual bootstrap |
| `sops` | CI decrypts `backend/secrets/<env>.env.enc` with `SOPS_AGE_KEY` and streams it to the host as `.env.<env>` (mode 600, never to disk on the runner) | no managed store yet; encrypted file is safe to commit |
| `command` | runs `SECRETS_COMMAND` (e.g. `aws secretsmanager get-secret-value ... \| jq -r ...`, `vault kv get -format=json ... \| jq ...`) which prints dotenv on stdout | cloud secret manager / an external Vault |
| `vault` (**production only**) | the self-hosted `vault` container on the prod deploy host; the deploy renders its secrets into tmpfs `*_FILE` mounts on the host (no plaintext `.env`, nothing passes through the runner) | prod, you run Vault yourself; refused for staging by `deploy.sh`/`deploy.yml`; see [Vault](#vault-self-hosted-container) |

SOPS bootstrap (once):

```bash
age-keygen -o age.key            # keep age.key in the password manager, public key goes below
cat > .sops.yaml <<'YAML'
creation_rules:
  - path_regex: backend/secrets/.*\.env\.enc$
    age: <age1...public key(s)>
YAML
sops --encrypt --input-type dotenv --output-type dotenv backend/.env.staging > backend/secrets/staging.env.enc
# store the age PRIVATE key as the SOPS_AGE_KEY Environment secret; delete the plaintext file
```

Note: compose `env_file` means the plaintext lands in `.env.<env>` on the host (root-owned, 600). That is the accepted minimum. Moving to `*_FILE` mounts on tmpfs (compose `secrets:`) removes it from the host disk and from `docker inspect`.

Acceptance check for "app boots in staging reading secrets from the store": set `SECRETS_PROVIDER` for the staging Environment, deploy, confirm `docker compose ps` healthy and `.env.staging` was written by the deploy (`ls -l`, mtime).

## Vault (self-hosted container)

**Vault is production-only.** The `vault` service exists only in `backend/compose.prod.yml`; dev and staging have no Vault container and `SECRETS_PROVIDER=vault` is valid only for the `production` Environment (`deploy.sh` exits 2 and `deploy.yml` fails for any other). Dev and staging read secrets from `.env.<env>` via `host`, `sops` or `command`, with `FOO_FILE` support unchanged.

Scope: this is the **MVP-minimum** use of Vault, a KV v2 store with least-privilege AppRole access, replacing plaintext `.env` secrets. **Not implemented, post-MVP (issue #76 "full Vault"): dynamic database credentials, the transit engine for field encryption, automated key rotation, auto-unseal, HA/Raft.** Nothing here claims them.

Files: `backend/ops/vault/` (`config.hcl` server config, `policy.hcl` read-only policy, `setup-approle.sh`, `render-secrets.sh`). Image `hashicorp/vault` is pinned in `compose.prod.yml` (bump deliberately; Dependabot's Docker ecosystem tracks it).

### Layout

- KV v2 mounted at `secret/`. One secret per consumer set and environment: `secret/zenflow/<env>/api` (used by `api` and `migrations`) and `secret/zenflow/<env>/bandit`. `BANDIT_SERVICE_TOKEN` is stored in both (each side needs it). Keys are env var names (`SESSION_SECRET`, `DATABASE_URL`, `MASTER_LMS_ENCRYPTION_KEY_V1`, ...).
- Policy `zenflow-api-<env>`: `read` on `secret/data/zenflow/<env>/*` only. No list, no write, no other environments.
- AppRole `zenflow-api-<env>`: tokens live 10 minutes (max 30), `secret_id` valid 30 days.
- `render-secrets.sh` logs in with the AppRole, reads each set and writes one file per key plus `files.env` (`FOO_FILE=/run/secrets/zenflow/FOO`) under `/run/zenflow/<env>/<set>/` on the **host tmpfs**. Compose mounts `.../api` into `api` and `migrations` and `.../bandit` into `bandit` at `/run/secrets/zenflow` (read-only) and loads `files.env` as an optional `env_file`. The existing `file-secrets.ts` and `docker-entrypoint.sh` do the rest; bandit reuses `docker-entrypoint.sh` (bind-mounted, entrypoint override in compose) because it only reads plain env vars.
- Still on `.env.<env>` (not Vault-backed yet): `POSTGRES_*` for the Postgres container (the image supports `POSTGRES_PASSWORD_FILE` natively, wire it up when needed), `S3_*` for the MinIO container root user, `GRAFANA_ADMIN_PASSWORD`. Remove a key from `.env.<env>` once it is served from Vault (an explicit `FOO` beats `FOO_FILE`).

### Local testing of the render script (no dev Vault service)

There is no Vault in the dev compose stack. To try `render-secrets.sh`, run a throwaway dev-mode server by hand (this is also what CI does):

```bash
docker run -d --name vault-smoke --cap-add IPC_LOCK -e VAULT_DEV_ROOT_TOKEN_ID=local-root \
  -p 127.0.0.1:8200:8200 hashicorp/vault:1.20.4 server -dev -dev-listen-address=0.0.0.0:8200
# put secret/zenflow/dev/{api,bandit}, run ops/setup-approle.sh with ENV_NAME=dev, then render-secrets.sh
docker rm -f vault-smoke
```

`.secrets-rendered/` is gitignored.

### Production: first-time init and unseal

The `vault` service uses file storage on the named volume `vault_data`, an `IPC_LOCK` cap, no UI, a plain-HTTP listener published on `127.0.0.1:8200` only (not on any network the app uses), and a healthcheck that treats sealed/uninitialised as "process up" (`sealedcode=200&uninitcode=200`). It always starts **sealed**.

1. Deploy once with `SECRETS_PROVIDER=host` (or start only Vault: `docker compose -f compose.prod.yml up -d vault`).
2. Initialise with 5 key shares and a threshold of 3, on the host, saving the output only into the password managers below:
   ```bash
   docker exec zenflow-vault-prod vault operator init -key-shares=5 -key-threshold=3
   ```
3. Unseal with three different shares (each holder enters theirs, ideally not all in one shell history): `docker exec -it zenflow-vault-prod vault operator unseal` (x3).
4. With the initial root token (`VAULT_TOKEN`), enable KV and load the secrets, then create the policy/AppRole and the host credentials:
   ```bash
   V="docker exec -e VAULT_TOKEN zenflow-vault-prod vault"
   $V secrets enable -path=secret -version=2 kv
   $V kv put -mount=secret zenflow/prod/api DATABASE_URL=... SESSION_SECRET=... ...   # prefer reading values from a prompt/file, not shell history
   $V kv put -mount=secret zenflow/prod/bandit BANDIT_SERVICE_TOKEN=...
   sudo install -d -m 700 /etc/zenflow/vault
   docker run --rm --network container:zenflow-vault-prod -v $PWD/backend/ops/vault:/ops:ro \
     -v /etc/zenflow/vault:/creds -e VAULT_ADDR=http://127.0.0.1:8200 -e VAULT_TOKEN -e ENV_NAME=prod \
     hashicorp/vault:1.20.4 /ops/setup-approle.sh --role-id-file /creds/role_id --secret-id-file /creds/secret_id
   ```
5. **Revoke the root token** (`vault token revoke -self`) and keep it out of daily use. Recreate one from the unseal shares only with `vault operator generate-root` when you truly need it (policy changes, new environment).
6. Set `SECRETS_PROVIDER=vault` on the GitHub Environment and deploy. The deploy starts Vault, **fails with a clear message if it is sealed** (HTTP 503) or uninitialised (501), renders the files, and force-recreates `api`, `migrations` and `bandit`.

**After every Vault restart or host reboot Vault is sealed** and deploys fail until three share holders unseal it. The apps already running keep working (they read files at boot only), but a restarted container cannot start without the rendered files; `/run` is tmpfs, so a **host reboot also clears the rendered secrets**. Re-run the deploy (or `render-secrets.sh` by hand) after unsealing. Plan for that in the on-call runbook.

### Who holds the key shares

Fill in and review quarterly. Rule: **no one person holds 3 shares**, shares live in different password managers/vaults (never the repo, CI, chat or the deploy host), and the root token is not stored at all.

| Share | Holder | Stored in | Reviewed |
| --- | --- | --- | --- |
| 1 | _name (owner)_ | _personal password manager_ | _date_ |
| 2 | _name (second maintainer)_ | _personal password manager_ | _date_ |
| 3 | _name_ | _personal password manager_ | _date_ |
| 4 | _name_ | _offline/sealed envelope or hardware token_ | _date_ |
| 5 | _name_ | _offline/sealed envelope or hardware token_ | _date_ |

With a single maintainer, split to threshold 2 of 3 held by two separate people if at all possible; one person holding everything is a single point of failure and compromise. Losing more than `shares - threshold` shares makes the data unrecoverable (see backup below).

Future option (documented, **not configured**): auto-unseal via a cloud KMS or Transit seal (`seal "awskms" { ... }` etc. in `config.hcl`) removes the manual unseal after reboots. It trades the human quorum for trust in the KMS IAM policy; migrate with `vault operator unseal -migrate`. Not done because the repo has no cloud account to bind to.

### AppRole credential rotation

`role_id` is an identifier, not a secret; `secret_id` is the credential (stored in `/etc/zenflow/vault/secret_id`, root-only 600, on the deploy host). It expires after 30 days, so rotate at least monthly (calendar it) and immediately if the host or the file is suspected exposed.

1. With an admin token (or a root token generated for the occasion): `ENV_NAME=prod ... setup-approle.sh --secret-id-file /creds/secret_id.new`. Old secret_ids stay valid until they expire, so this has no downtime.
2. On the host move the new file over `/etc/zenflow/vault/secret_id` (`mv`, 600).
3. Run a deploy (or `render-secrets.sh` by hand) and confirm the login works.
4. Revoke the old one if exposure is suspected: `vault write auth/approle/role/zenflow-api-prod/secret-id-accessor/destroy secret_id_accessor=<accessor>` (list with `vault list auth/approle/role/zenflow-api-prod/secret-id`). To rotate the `role_id` itself: `vault write auth/approle/role/zenflow-api-prod/role-id role_id=$(uuidgen)` then re-run `setup-approle.sh --role-id-file`.

### Backup and restore of the Vault volume

The volume `vault_data` holds the encrypted data; it is useless without 3 unseal shares, but keep the backups encrypted anyway and off the host.

```bash
# backup (file backend: stop Vault briefly so the files are consistent)
docker compose -f compose.prod.yml stop vault
docker run --rm -v zenflow-prod_vault_data:/v:ro -v "$PWD":/out alpine tar czf /out/vault-$(date +%F).tgz -C /v .
docker compose -f compose.prod.yml start vault        # then unseal
# restore (into an empty volume, Vault stopped)
docker compose -f compose.prod.yml stop vault
docker run --rm -v zenflow-prod_vault_data:/v -v "$PWD":/in alpine sh -c 'rm -rf /v/* && tar xzf /in/vault-YYYY-MM-DD.tgz -C /v'
docker compose -f compose.prod.yml start vault        # then unseal with the SAME shares
```

(The volume name is `<compose project>_vault_data`, e.g. `zenflow-prod_vault_data`; check `docker volume ls`.) Restore always needs the unseal shares that were current when the backup was taken. Test a restore on a scratch host before relying on it. A rebuilt, never-initialised Vault is not a restore: re-run `operator init` and re-load every secret from their upstream sources.

### Rotation runbooks with Vault

The three runbooks above stay the same except that "update the store" means writing to Vault (`vault kv patch -mount=secret zenflow/prod/api KEY=...`, which creates a new KV version; the old one stays in history, `vault kv rollback` undoes a bad write) and "deploy" re-renders and force-recreates the containers.

- **Session key**: patch `SESSION_SECRET`, deploy. Same forced logout of all users.
- **Database password**: do the `ALTER USER` step, then patch `DATABASE_URL` in Vault and deploy. `POSTGRES_PASSWORD` still lives in `.env.<env>` for the Postgres container until it is moved to `POSTGRES_PASSWORD_FILE`; update it there too. Rotation is by hand: **dynamic DB credentials (Vault database engine) are post-MVP.**
- **Crypto master keys**: add `MASTER_*_ENCRYPTION_KEY_V2` with `kv patch` (patch keeps V1, which must stay while rows reference it), ship the code change, deploy. Never `kv put` over the set without V1; `kv put` replaces all keys. Vault's KV version history is not a substitute for the re-wrap job described above, and **transit-engine key management (Vault wrapping the DEKs) is post-MVP**.

## Rotation runbooks

Rotate immediately on suspected exposure; otherwise at least yearly. Always update the store first, then deploy, then revoke the old value.

### Session signing key (`SESSION_SECRET`) - the "JWT key"

There is no JWT. `express-session` is given a single secret string (`auth/session.config.ts`), not a list, so there is no overlap window.

1. Generate: `openssl rand -hex 48`.
2. Update the store, deploy.
3. Effect: **every existing session cookie fails signature verification, all users are logged out** and must re-request an OTP. Redis session data is not corrupted. Schedule off-peak.
4. (Optional improvement, not implemented) pass `[new, old]` to `express-session` to avoid the forced logout.

### Database password

Postgres 16/18 compose: the `POSTGRES_PASSWORD` env var is only read when the data directory is first initialised, so changing the env var alone does NOT change the password.

1. Generate a password: `openssl rand -hex 24`.
2. `docker compose exec postgres psql -U $POSTGRES_USER -c "ALTER USER $POSTGRES_USER PASSWORD '<new>';"` (existing connections stay valid).
3. Update `POSTGRES_PASSWORD` and the password inside `DATABASE_URL` (URL-encode special characters) in the store.
4. Redeploy so `api` and `migrations` pick it up (brief reconnect; run off-peak).
5. Confirm logins work; the old password is dead already after step 2.

For a zero-downtime variant create a second role, switch `DATABASE_URL` to it, then drop the old role. Managed DB: use the provider's rotation feature.

### Crypto master keys (`MASTER_*_ENCRYPTION_KEY_V<n>`)

What the code actually supports (`backend/src/crypto/master-key.service.ts`, `UserEncryptionKey.masterKeyVersion`):

- Each wrapped DEK row records which `..._V<n>` wrapped it, and `unwrap` resolves that exact env var. So **old versions must stay configured for as long as any row references them**; deleting a still-referenced key makes those users' stored DLU credentials permanently undecryptable.
- New wraps use `CURRENT_MASTER_KEY_VERSION`. Adding a version requires a code change: add `MASTER_<P>_ENCRYPTION_KEY_V2` to the Joi schema in `app.module.ts` (the schema currently only knows `V1`, and unknown env vars are not rejected but V2 would be unvalidated), bump `CURRENT_MASTER_KEY_VERSION`, and ship it.
- DEKs are only created on a user's first integration (`integrations.service.ts` reuses an existing DEK), so bumping the version only affects **new** users.
- **There is no re-wrap job and no DEK rotation job.** Existing rows stay on V1 forever until someone writes one (read each row, `unwrap` with its recorded version, `wrap` with the current one, update `masterKeyVersion`; wrapped DEK ciphertext changes, the DEK and the credential ciphertext do not).

Consequences:

- Routine rotation (no known compromise): add V2 as above (new users only); keep V1. This is hygiene, not remediation.
- **V1 is compromised** (see the leak audit below: it was committed once): adding V2 is not enough. Required work: (1) write and run the re-wrap script in a maintenance window with a DB backup first, (2) verify every row has `masterKeyVersion = 2`, (3) only then remove V1 from the store. Because the old key was exposed together with possibly a DB snapshot, also consider asking users to re-link DLU credentials and rotate the DLU passwords, since the DEKs and ciphertexts could have been decrypted offline.
- Generate keys with `openssl rand -hex 32` (64 hex chars; Joi enforces length and hex).

## Leak audit (git history and env files)

Performed on 2026-10-04 by listing names and value lengths only; no values were printed.

- Current tree: no tracked secret files except `backend/.env.example` (placeholders and dev defaults) and the public `backend/certs/lms-ca.pem`. `frontend/.env.*` and `mobile/.env.development` hold public client config only. A scan of tracked files for private-key/AWS/GitHub-token patterns found one hit: a synthetic key in `backend/src/devices/apns.sender.spec.ts` (a stub `-----BEGIN PRIVATE KEY-----\nk` test fixture, not a real key; the spec is allowlisted in `.gitleaks.toml`).
- **History (851 commits): real env files were committed.** `backend/.env`, `.env.dev`, `.env.prod`, `.env.staging`, `.env.test`, `.env.sim`, and `backend/docker*.env` were tracked at various points between 2025-10 and 2026-10-04 (the `docker*.env` files were last touched the day of this audit), and are still present in history and in any clone or fork. They are now untracked and gitignored, but history was not rewritten.
  - Prod (`.env.prod` at `e4033eb`/`17110c8`): contains a 130-character `SESSION_SECRET`, a 112-character `MAIL_TRANSPORT` (almost certainly SMTP credentials) and `DATABASE_URL`.
  - Dev/staging/prod/test at `fa16f8e`/`63c6797`: `MASTER_LMS_ENCRYPTION_KEY_V1` and `MASTER_PORTAL_ENCRYPTION_KEY_V1` with 66-character values (likely 64 hex characters plus surrounding quotes). Whether the prod ones equal the dev ones was not compared.
  - Weak placeholders (`SESSION_SECRET` of 8 chars, `POSTGRES_PASSWORD` of 5 chars) in dev/test/staging files.

**Rotate (assume compromised, anything that was ever in prod):**

1. `SESSION_SECRET` (prod and staging): runbook above.
2. SMTP credentials in `MAIL_TRANSPORT` at the mail provider.
3. Prod and staging DB passwords (and confirm the DB is not publicly reachable, since `DATABASE_URL` host/user were exposed).
4. `MASTER_LMS_*` and `MASTER_PORTAL_*` V1 keys, using the compromised-key procedure above (needs the re-wrap script).
5. Anything in `PORTAL_API_KEY`, `S3_*`, `BANDIT_SERVICE_TOKEN`, `FCM_*`, `APNS_*` if it was ever set in those committed files (the checked versions had none of the push/bandit vars; `S3_*` and `PORTAL_API_KEY` presence per commit was not exhaustively verified, so rotate S3 keys and refresh the portal key to be safe).
6. Decide whether to purge history (`git filter-repo --path backend/.env --path ... --invert-paths`, then force-push and have everyone re-clone). Purging does not un-leak anything already cloned; rotation is what counts. Also check forks, CI logs and the `backup/issue-56-pre-cleanup` branch, which still carry the old files.

## Who has access (template - fill in)

| Store / system | Who | Access level | Granted by | Reviewed |
| --- | --- | --- | --- | --- |
| Production secret store | _names_ | read / write | _owner_ | _date_ |
| Staging secret store | _names_ | read / write | _owner_ | _date_ |
| `SOPS_AGE_KEY` / age private key | _names_ | holder | _owner_ | _date_ |
| GitHub `production` Environment reviewers | _names_ | approve deploys | _owner_ | _date_ |
| GitHub repo admins (can read Environment secrets via workflows) | _names_ | admin | _owner_ | _date_ |
| Deploy host SSH | _names_ | root / deploy user | _owner_ | _date_ |
| SMTP / Firebase / Apple accounts | _names_ | admin | _owner_ | _date_ |

Review quarterly and on every offboarding; rotate anything the departing person could read.

## Guardrails

- Compose files (Vault only in prod), `ops/vault/config.hcl` and the policy are checked in CI (`vault` job); they contain no secrets. Vault seal keys and root token must never be committed.
- `gitleaks` runs on every PR (`ci.yml`, config in `.gitleaks.toml`). Optionally add a local hook: `gitleaks protect --staged`.
- Never paste env values into issues, PRs or CI logs; CI masks the generated test values.
- Test and CI secrets are generated per run (`.github/scripts/write-test-env.sh`).
