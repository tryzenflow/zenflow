# Secrets management

Issue #76. Minimum viable setup: secrets live in a managed store (or SOPS-encrypted files), are injected at deploy time, and never exist in the repo or in an image. Full Vault (dynamic DB credentials, transit encryption) is post-MVP.

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
| `command` | runs `SECRETS_COMMAND` (e.g. `aws secretsmanager get-secret-value ... \| jq -r ...`, `vault kv get -format=json ... \| jq ...`) which prints dotenv on stdout | cloud secret manager / Vault |

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

- `gitleaks` runs on every PR (`ci.yml`, config in `.gitleaks.toml`). Optionally add a local hook: `gitleaks protect --staged`.
- Never paste env values into issues, PRs or CI logs; CI masks the generated test values.
- Test and CI secrets are generated per run (`.github/scripts/write-test-env.sh`).
