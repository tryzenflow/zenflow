# Secrets management

For maintainers and operators (issue #76). Secrets live in a managed store (or SOPS-encrypted files), are injected at deploy time, and never exist in the repo or an image.
If it would hurt to see it in a screenshot, it is a secret and goes through this document.
Self-hosted Vault (prod only): [vault.md](vault.md).

## Inventory

Values are never listed. `backend/.env.example` shows the shape.

| Secret | Used by | Where | Rotation |
| --- | --- | --- | --- |
| `POSTGRES_PASSWORD` (the app composes its connection from it; there is no `DATABASE_URL`) | API, migrations, Postgres, backup | store; Vault sets `api`, `postgres`, `backup` | [runbook](#database-password) |
| `SESSION_SECRET` | signs the session cookie (`express-session`); no JWT in this app | store | [runbook](#session-signing-key-session_secret) |
| `FILE_URL_SECRET` | HMAC-SHA256 key for signed, non-expiring file URLs (`/files/:id?sig=`); notes store only the file id and the API signs on read | store | change and redeploy; notes need no rewrite |
| `MASTER_LMS_ENCRYPTION_KEY_V<n>`, `MASTER_PORTAL_ENCRYPTION_KEY_V<n>` | wrap per-user DEKs that protect stored DLU/LMS credentials (`backend/src/crypto`) | store; never only in the DB | [runbook](#crypto-master-keys-master__encryption_key_vn) |
| `PORTAL_API_KEY` | DLU portal API key (expires upstream, from a browser session) | store | replace when DLU invalidates it |
| `MAIL_PASSWORD` | SMTP password (host, port and user are non-secret `MAIL_*`) | store | at the SMTP provider |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | file storage; also the MinIO root user/password in compose | store; Vault sets `api` and `minio` | rotate in MinIO/S3, redeploy |
| `BANDIT_SERVICE_TOKEN` | bearer for `POST /v1/place`; bandit also accepts `BANDIT_SERVICE_TOKEN_PREVIOUS` | store (both services) | zero-downtime: new on bandit with old as `_PREVIOUS`, then API, then drop `_PREVIOUS` |
| `FCM_SERVICE_ACCOUNT`, `APNS_KEY` (+ `APNS_KEY_ID`, `APNS_TEAM_ID`) | push notifications | store | Firebase / Apple developer portal |
| `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY`, `BACKUP_AGE_RECIPIENT`, `BACKUP_AGE_IDENTITY` | backup container; IAM user is put + list only. `BACKUP_AGE_RECIPIENT` is public; `BACKUP_AGE_IDENTITY` is the restore-test key, never the offline master key | store, injected into `.env.<env>` | [runbook](backups.md#rotation) |
| `GRAFANA_ADMIN_PASSWORD` | Grafana (staging, prod; prod refuses to start without it) | store | change and redeploy |
| `GF_SMTP_PASSWORD` | Grafana alert mail: Mailgun SMTP credential for `postmaster@alerts.alphatrann.com` (prod) | Vault `grafana` set | reset in Mailgun, redeploy |
| `SESSION_REDIS_HOST`, `RATE_LIMIT_REDIS_HOST`, `QUEUE_REDIS_HOST`, `REDIS_PUBSUB_HOST`, `REDIS_KILLSWITCH_HOST` (each with an optional `_PASSWORD`) | Redis ([ADR-0005](../adr/0005-rate-limit-store-lru-rdb.md), [ADR-0007](../adr/0007-bullmq-for-notification-queue.md), [ADR-0018](../adr/0018-redis-pubsub-instance.md)); unauthenticated on internal-only Docker networks | n/a | add a password if the network assumption changes |
| Per-user DLU/LMS credentials | `Integration` rows in Postgres, encrypted under per-user DEKs | DB (ciphertext only) | by the user |
| `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`, `SOPS_AGE_KEY`, `SECRETS_COMMAND` | CI deploy | GitHub Environment secrets | yearly or on offboarding |
| `GITHUB_TOKEN` | image push/pull | per workflow run | automatic |

Not secrets: `VITE_*`, `EXPO_PUBLIC_*` (shipped to clients), `backend/certs/lms-ca.pem` (public CA), `CORS_ORIGIN`, hosts, ports, usernames (`POSTGRES_USER`, `MAIL_USER`), database and bucket names, URLs without credentials.
These go in the non-secret env file (`backend/env/prod.env` for prod), never in Vault. A name must not be in both.

## How secrets reach the app

- The app reads `ConfigService` / `process.env`; `ConfigModule` never overrides an existing variable.
- Images hold no env files: `.dockerignore` excludes `**/*.env*`, and CI checks the built image.

| Method | How |
| --- | --- |
| Environment variables | platform-supplied (compose `env_file`, ECS/K8s secret refs) |
| `*_FILE` variants | `POSTGRES_PASSWORD_FILE=/run/secrets/postgres_password`; works for any variable (Docker/Swarm/K8s mounts, Vault Agent, SOPS to tmpfs) |

`*_FILE` rules:

- An explicit `FOO` wins over `FOO_FILE`.
- One trailing newline is stripped.
- An unreadable file aborts boot.
- Implemented in `backend/src/common/config/file-secrets.ts` (imported first in `main.ts`) and `backend/docker-entrypoint.sh` (for the Prisma CLI in `migrations`).
- Bandit reads env vars only, except through the Vault entrypoint ([vault.md](vault.md)).

### Deploy-time injection (`scripts/deploy/deploy.sh`, `SECRETS_PROVIDER`)

| Provider | How | Use when |
| --- | --- | --- |
| `host` (default) | `backend/.env.<env>` already on the host, written by your secret-manager agent | Vault Agent, cloud sidecar/cron, manual bootstrap |
| `sops` | CI decrypts `backend/secrets/<env>.env.enc` with `SOPS_AGE_KEY`, streams it to the host as `.env.<env>` (600, never on the runner disk) | no managed store yet; the encrypted file is safe to commit |
| `command` | runs `SECRETS_COMMAND`, which prints dotenv on stdout (e.g. `aws secretsmanager get-secret-value ... \| jq -r ...`) | cloud secret manager, external Vault |
| `vault` (**prod only**) | self-hosted `vault` container; deploy renders one set per consumer into host tmpfs (`*_FILE` mounts for API/Bandit, plain env files for Postgres, MinIO, Grafana, backup). The non-secret `backend/env/prod.env` is shipped as `.env.prod`; secrets never pass through the runner. A key in both aborts the deploy | prod; refused for staging; see [vault.md](vault.md) |

SOPS bootstrap (once):

```bash
age-keygen -o age.key            # keep age.key in the password manager; public key goes below
cat > .sops.yaml <<'YAML'
creation_rules:
  - path_regex: backend/secrets/.*\.env\.enc$
    age: <age1...public key(s)>
YAML
mkdir -p backend/secrets
sops --encrypt --input-type dotenv --output-type dotenv backend/.env.staging > backend/secrets/staging.env.enc
# store the age PRIVATE key as the SOPS_AGE_KEY Environment secret; delete the plaintext file
```

- With compose `env_file`, plaintext lands in `.env.<env>` on the host (root-owned, 600). That is the accepted minimum.
- `*_FILE` mounts on tmpfs (compose `secrets:`) would remove it from host disk and `docker inspect`.
- Staging acceptance check: set `SECRETS_PROVIDER` on the staging Environment, deploy, confirm `docker compose ps` is healthy and `ls -l` shows a fresh `.env.staging` mtime.

## Rotation runbooks

Rotate at once on suspected exposure, otherwise at least yearly. Order: update the store, deploy, revoke the old value.
With Vault, see [Rotation with Vault](vault.md#rotation-with-vault).

### Session signing key (`SESSION_SECRET`)

`express-session` takes a single secret (`auth/session.config.ts`), not a list, so there is no overlap window.

1. Generate: `openssl rand -hex 48`.
2. Update the store, deploy off-peak.
3. Effect: every session cookie fails verification, all users are logged out and must request a new OTP. Redis session data is not corrupted.
4. Not implemented: pass `[new, old]` to `express-session` to avoid the forced logout.

### Database password

Compose Postgres (18) reads `POSTGRES_PASSWORD` only when the data directory is first initialised; changing the env var alone does not change the password.

1. Generate: `openssl rand -hex 24`.
2. Change it in the DB (existing connections stay valid; the username expands inside the container):
   ```bash
   docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -c "ALTER USER \"$POSTGRES_USER\" PASSWORD '"'"'<new>'"'"';"'
   ```
3. Update `POSTGRES_PASSWORD` in the store (with Vault: in all three sets, `api`, `postgres` and `backup`). Any characters are fine; the app URL-encodes it.
4. Redeploy so `api` and `migrations` pick it up (brief reconnect; off-peak).
5. Confirm logins work. The old password is already dead after step 2.

Zero-downtime variant: create a second role, switch `POSTGRES_USER` and `POSTGRES_PASSWORD` to it, drop the old role. Managed DB: use the provider's rotation.

### Crypto master keys (`MASTER_*_ENCRYPTION_KEY_V<n>`)

What the code supports (`backend/src/crypto/master-key.service.ts`, `UserEncryptionKey.masterKeyVersion`):

- Each wrapped DEK row records its `..._V<n>`; `unwrap` resolves that exact env var.
- Old versions must stay configured while any row references them. Deleting one makes those users' DLU credentials permanently undecryptable.
- New wraps use `CURRENT_MASTER_KEY_VERSION` (currently 1).
- DEKs are created on a user's first integration only, so a version bump affects **new** users only.
- **There is no re-wrap or DEK rotation job.** Existing rows stay on V1 until someone writes one:
  read each row, `unwrap` with its recorded version, `wrap` with the current one, update `masterKeyVersion`.
  Only the wrapped DEK ciphertext changes.

Adding a version (code change):

1. Add `MASTER_<P>_ENCRYPTION_KEY_V2` to the Joi schema in `app.module.ts` (currently only `V1`; V2 would be unvalidated).
2. Bump `CURRENT_MASTER_KEY_VERSION` and ship.
3. Generate keys with `openssl rand -hex 32` (64 hex chars; Joi enforces length and hex).

| Case | Required work |
| --- | --- |
| Routine rotation (no compromise) | add V2 as above (new users only), keep V1; hygiene, not remediation |
| V1 compromised (see the leak audit: it was committed) | 1. back up the DB, write and run the re-wrap script in a maintenance window. 2. Verify every row has `masterKeyVersion = 2`. 3. Only then remove V1 from the store. |

If V1 leaked alongside a possible DB snapshot, DEKs and ciphertexts could be decrypted offline.
Also consider asking users to re-link DLU credentials and rotate their DLU passwords.

## Leak audit (git history and env files)

Done 2026-10-04 by listing names and value lengths only; no values were printed.

**Current tree**
- No tracked secret files except `backend/.env.example` (placeholders, dev defaults) and the public `backend/certs/lms-ca.pem`.
- `frontend/.env.*` and `mobile/.env.development` hold public client config only.
- A scan for private-key, AWS and GitHub-token patterns hit one file: `backend/src/devices/apns.sender.spec.ts`, a synthetic stub key, allowlisted in `.gitleaks.toml`.

**History (851 commits): real env files were committed**
- Files: `backend/.env`, `.env.dev`, `.env.prod`, `.env.staging`, `.env.test`, `.env.sim`, `backend/docker*.env`.
- Tracked at various points between 2025-10 and 2026-10-04; now untracked and gitignored, but history was not rewritten and clones and forks still carry them.

| Where | Exposed |
| --- | --- |
| `.env.prod` at `e4033eb` / `17110c8` | 130-char `SESSION_SECRET`, 112-char `MAIL_TRANSPORT` (almost certainly SMTP credentials), `DATABASE_URL` |
| dev, staging, prod, test at `fa16f8e` / `63c6797` | `MASTER_LMS_ENCRYPTION_KEY_V1`, `MASTER_PORTAL_ENCRYPTION_KEY_V1`, 66-char values (likely 64 hex plus quotes); prod vs dev equality not compared |
| dev, test, staging | weak placeholders: 8-char `SESSION_SECRET`, 5-char `POSTGRES_PASSWORD` |

**Rotate (assume compromised; anything ever in prod)**

1. `SESSION_SECRET` (prod, staging): [runbook](#session-signing-key-session_secret).
2. SMTP credentials in `MAIL_TRANSPORT`, at the mail provider.
3. Prod and staging DB passwords; confirm the DB is not publicly reachable (`DATABASE_URL` host and user were exposed).
4. `MASTER_LMS_*` and `MASTER_PORTAL_*` V1: compromised-key procedure above (needs the re-wrap script).
5. `PORTAL_API_KEY`, `S3_*`, `BANDIT_SERVICE_TOKEN`, `FCM_*`, `APNS_*` if ever set in those files.
   Checked versions had no push or bandit vars; `S3_*` and `PORTAL_API_KEY` per commit were not exhaustively verified, so rotate S3 keys and refresh the portal key.
6. Decide on purging history: `git filter-repo --path backend/.env --path ... --invert-paths`, force-push, everyone re-clones.
   Purging does not un-leak anything already cloned; rotation is what counts.
   Also check forks, CI logs and branch `backup/issue-56-pre-cleanup`, which still carry the files.

## Who has access (template, fill in)

Review quarterly and on every offboarding; rotate anything the departing person could read.

| Store / system | Who | Access level | Granted by | Reviewed |
| --- | --- | --- | --- | --- |
| Production secret store | _names_ | read / write | _owner_ | _date_ |
| Staging secret store | _names_ | read / write | _owner_ | _date_ |
| `SOPS_AGE_KEY` / age private key | _names_ | holder | _owner_ | _date_ |
| GitHub `production` Environment reviewers | _names_ | approve deploys | _owner_ | _date_ |
| GitHub repo admins (can read Environment secrets via workflows) | _names_ | admin | _owner_ | _date_ |
| Deploy host SSH | _names_ | root / deploy user | _owner_ | _date_ |
| SMTP / Firebase / Apple accounts | _names_ | admin | _owner_ | _date_ |

## Guardrails

- CI `vault` job checks all compose files (Vault only in prod), `ops/vault/config.hcl` and the policy. None contain secrets.
- Never commit Vault seal keys or the root token.
- `gitleaks` runs on every PR (`ci.yml`, config `.gitleaks.toml`). Optional local hook: `gitleaks protect --staged`.
- Never paste env values into issues, PRs or CI logs; CI masks generated test values.
- Test and CI secrets are generated per run (`.github/scripts/write-test-env.sh`).
