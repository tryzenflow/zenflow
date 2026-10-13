# Secrets management

For maintainers and operators (issue #76). Secrets live in a managed store or SOPS files, are injected at deploy time, and never enter the repo or an image. Prod Vault: [vault.md](vault.md).

## Inventory

Values are never listed. [`backend/.env.example`](../../backend/.env.example) shows the shape.

| Secret | Used by | Rotation |
| --- | --- | --- |
| `POSTGRES_PASSWORD` | API, migrations, Postgres, backup (Vault sets `api`, `postgres`, `backup`) | [runbook](#database-password) |
| `SESSION_SECRET` | Signs the session cookie | [runbook](#session-signing-key-session_secret) |
| `FILE_URL_SECRET` | HMAC key for signed file URLs (`/files/:id?sig=`) | Change and redeploy. Notes need no rewrite |
| `MASTER_LMS_ENCRYPTION_KEY_V<n>`, `MASTER_PORTAL_ENCRYPTION_KEY_V<n>` | Wrap per-user DEKs for DLU and LMS credentials (`backend/src/crypto`) | [runbook](#crypto-master-keys-master__encryption_key_vn) |
| `PORTAL_API_KEY` | DLU portal API key | Replace when DLU invalidates it |
| `MAIL_PASSWORD` | SMTP password | At the SMTP provider |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | File storage and MinIO root (Vault sets `api`, `minio`) | Rotate in MinIO or S3, redeploy |
| `BANDIT_SERVICE_TOKEN` | Bearer for `POST /v1/place` (both services) | Set the new value on bandit with the old as `BANDIT_SERVICE_TOKEN_PREVIOUS`, then API, then drop `_PREVIOUS` |
| `FCM_SERVICE_ACCOUNT`, `APNS_KEY`, `APNS_KEY_ID`, `APNS_TEAM_ID` | Push | Firebase or Apple portal |
| `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY`, `BACKUP_AGE_RECIPIENT`, `BACKUP_AGE_IDENTITY` | Backup container. `BACKUP_AGE_RECIPIENT` is public. `BACKUP_AGE_IDENTITY` is the restore-test key, never the master key | [runbook](backups.md#rotation) |
| `GRAFANA_ADMIN_PASSWORD` (staging), `GF_SECURITY_ADMIN_PASSWORD` (prod) | Grafana admin | Change, redeploy |
| `GF_SMTP_PASSWORD` | Grafana alert mail (prod, Vault `grafana`) | Reset in Mailgun, redeploy |
| `SESSION_REDIS_PASSWORD`, `RATE_LIMIT_REDIS_PASSWORD`, `QUEUE_REDIS_PASSWORD`, `REDIS_KILLSWITCH_PASSWORD`, `REDIS_PUBSUB_PASSWORD` | One per prod Redis. App (`api` set) and the instance's own set. Dev, test and staging run without | [runbook](#redis-passwords) |
| Per-user DLU and LMS credentials | `Integration` rows, encrypted under per-user DEKs | By the user |
| `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`, `SOPS_AGE_KEY`, `SECRETS_COMMAND` | CI deploy (GitHub Environment secrets) | Yearly or on offboarding |
| `GITHUB_TOKEN` | Image push and pull | Automatic |

Not secrets: `VITE_*`, `EXPO_PUBLIC_*`, `backend/certs/lms-ca.pem`, `CORS_ORIGIN`, hosts, ports, usernames, database and bucket names, URLs without credentials. They go in the non-secret env file (`backend/env/prod.env` for prod), never in Vault. A name must not be in both.

## How secrets reach the app

- The app reads `ConfigService` and `process.env`. `ConfigModule` never overrides an existing variable.
- Images hold no env files: `.dockerignore` excludes `**/*.env*` and CI checks the built image.

| Method | How |
| --- | --- |
| Environment variables | Platform-supplied (compose `env_file`, ECS or K8s refs) |
| `*_FILE` variants | `POSTGRES_PASSWORD_FILE=/run/secrets/postgres_password`. Works for any variable |

`*_FILE` rules:

- An explicit `FOO` wins over `FOO_FILE`.
- One trailing newline is stripped.
- An unreadable file aborts boot.
- Code: `backend/src/common/config/file-secrets.ts` (imported first in `main.ts`) and `backend/docker-entrypoint.sh` (Prisma CLI in `migrations`).
- Bandit reads plain env vars only, except through the Vault entrypoint ([vault.md](vault.md)).

### Deploy-time injection

`scripts/deploy/deploy.sh`, set by `SECRETS_PROVIDER`:

| Provider | How |
| --- | --- |
| `host` (default) | `backend/.env.<env>` already on the host, written by your secret-manager agent |
| `sops` | CI decrypts `backend/secrets/<env>.env.enc` with `SOPS_AGE_KEY`, streams it to the host as `.env.<env>` (600). The encrypted file is safe to commit |
| `command` | Runs `SECRETS_COMMAND`, which prints dotenv on stdout |
| `vault` | Prod only. See [vault.md](vault.md). Refused for staging |

SOPS bootstrap (once):

```bash
age-keygen -o age.key            # keep in the password manager
cat > .sops.yaml <<'YAML'
creation_rules:
  - path_regex: backend/secrets/.*\.env\.enc$
    age: <age1...public key(s)>
YAML
mkdir -p backend/secrets
sops --encrypt --input-type dotenv --output-type dotenv backend/.env.staging > backend/secrets/staging.env.enc
# store the age PRIVATE key as the SOPS_AGE_KEY Environment secret; delete the plaintext file
```

With `env_file`, plaintext lands in `.env.<env>` on the host (deploy user, 600, see [server-access.md](server-access.md)).

Staging check: set `SECRETS_PROVIDER`, deploy, confirm `docker compose ps` is healthy and `.env.staging` has a fresh mtime.

## Rotation runbooks

Rotate at once on suspected exposure, otherwise yearly. Order: update the store, deploy, revoke the old value. With Vault: [Rotation with Vault](vault.md#rotation-with-vault).

### Session signing key (`SESSION_SECRET`)

1. `openssl rand -hex 48`.
2. Update the store, deploy off-peak.
3. Every session cookie fails and all users log in again with a new OTP.

`express-session` takes one secret, so there is no overlap window.

### Database password

Postgres reads `POSTGRES_PASSWORD` only on first init, so changing the env var alone does nothing.

1. `openssl rand -hex 24`.
2. Change it in the DB (existing connections stay valid):
   ```bash
   docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -c "ALTER USER \"$POSTGRES_USER\" PASSWORD '"'"'<new>'"'"';"'
   ```
3. Update `POSTGRES_PASSWORD` in the store (Vault: `api`, `postgres`, `backup`). The app URL-encodes it.
4. Redeploy `api` and `migrations` off-peak.
5. Confirm logins work.

Zero-downtime: create a second role, switch `POSTGRES_USER` and `POSTGRES_PASSWORD`, drop the old role. Managed DB: use the provider's rotation.

### Redis passwords

Each prod Redis sets its password at start from its Vault set (`backend/ops/redis/start.sh`). Without one it refuses to start. Other providers: put the five `*_REDIS_PASSWORD` values in `.env.<env>`.

1. `openssl rand -hex 24` (single line only).
2. Patch both sets, for example `api` and `session-redis` (the session password also feeds `redis-exporter`).
3. Deploy off-peak. The serving colour loses that Redis until the flip, so expect a short outage of sessions, rate limits, queues or SSE. The kill switch falls back to its fail-safe defaults.
4. Confirm `docker exec -e REDISCLI_AUTH=... <container> redis-cli ping` returns `PONG` and `/api/v1/health` is green.

Data survives on the AOF and RDB volumes.

### Crypto master keys (`MASTER_*_ENCRYPTION_KEY_V<n>`)

Code: `backend/src/crypto/master-key.service.ts`, `UserEncryptionKey.masterKeyVersion`.

- Each wrapped DEK records its version. `unwrap` reads that exact env var.
- Keep old versions configured while any row uses them. Deleting one makes those credentials permanently undecryptable.
- New wraps use `MASTER_KEY_CURRENT_VERSION` (default 1). Boot fails unless both `_V<current>` keys exist. Every key must be 64 hex.
- DEKs are created on a user's first integration, so a bump affects new users only.
- There is no re-wrap job. Existing rows stay on V1 until one is written: read each row, `unwrap` with its version, `wrap` with the current one, update `masterKeyVersion`.

Add a version (config only):

1. `openssl rand -hex 32` for each key.
2. Add `MASTER_LMS_ENCRYPTION_KEY_V2` and `MASTER_PORTAL_ENCRYPTION_KEY_V2`. Keep V1.
3. Set `MASTER_KEY_CURRENT_VERSION=2`, deploy. Roll back by setting it to 1 (V2 stays configured).

| Case | Work |
| --- | --- |
| Routine | Add V2 (new users only), keep V1 |
| V1 compromised (it was committed, see below) | Back up the DB, run a re-wrap in a maintenance window, verify every row is `masterKeyVersion = 2`, then remove V1. Ask users to re-link DLU credentials and change their DLU passwords |

## Leak audit

Audited 2026-10-04 (names and lengths only). Real env files (`backend/.env`, `.env.dev`, `.env.prod`, `.env.staging`, `.env.test`, `.env.sim`, `backend/docker*.env`) were committed between 2025-10 and 2026-10-04. They are untracked and gitignored now, but history was not rewritten and clones still carry them.

Exposed: prod `SESSION_SECRET`, `MAIL_TRANSPORT` (SMTP credentials), `DATABASE_URL`, `MASTER_*_V1` keys, and weak dev, test and staging placeholders.

Rotate, assuming compromise:

1. `SESSION_SECRET` (prod, staging): [runbook](#session-signing-key-session_secret).
2. SMTP credentials at the mail provider.
3. Prod and staging DB passwords. Confirm the DB is not publicly reachable.
4. `MASTER_*` V1: compromised-key row above.
5. `PORTAL_API_KEY`, `S3_*`, `BANDIT_SERVICE_TOKEN`, `FCM_*`, `APNS_*` if ever set there. Rotate S3 keys and refresh the portal key.
6. Optionally purge history with `git filter-repo --path backend/.env --path ... --invert-paths`, force-push and re-clone. Rotation is what counts. Check forks, CI logs and branch `backup/issue-56-pre-cleanup`.

The tree is clean: only `backend/.env.example`, the public `backend/certs/lms-ca.pem`, and a synthetic key in `backend/src/devices/apns.sender.spec.ts` (allowlisted in `.gitleaks.toml`).

## Access (fill in)

Review quarterly and on offboarding. Rotate anything the departing person could read.

| System | Who | Access | Granted by | Reviewed |
| --- | --- | --- | --- | --- |
| Production secret store | _names_ | read, write | _owner_ | _date_ |
| Staging secret store | _names_ | read, write | _owner_ | _date_ |
| `SOPS_AGE_KEY` | _names_ | holder | _owner_ | _date_ |
| GitHub `production` reviewers | _names_ | approve deploys | _owner_ | _date_ |
| GitHub repo admins | _names_ | admin | _owner_ | _date_ |
| Deploy host SSH | _names_ | `admin` (sudo), `deploy` (CI) | _owner_ | _date_ |
| SMTP, Firebase, Apple accounts | _names_ | admin | _owner_ | _date_ |

## Guardrails

- CI `vault` job checks every compose file, `config.hcl` and the policy for secrets.
- Never commit Vault seal keys or the root token.
- `gitleaks` runs on every PR (`ci.yml`, `.gitleaks.toml`). Local: `gitleaks protect --staged`.
- Never paste env values into issues, PRs or CI logs.
- Test and CI secrets are generated per run (`.github/scripts/write-test-env.sh`).
