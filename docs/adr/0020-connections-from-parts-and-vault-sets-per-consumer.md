# ADR-0020: Connections from parts, one Vault set per consumer

**Status:** accepted
**Date:** 2026-10-10
**Issue:** none

## Context
- Connection settings were URL vars (`DATABASE_URL`, `CACHE_URL`, `MAIL_TRANSPORT`, ...). Two held passwords, and the Postgres password existed twice (`POSTGRES_PASSWORD` and inside `DATABASE_URL`) with a "must match" rule.
- Prod secrets sat in three Vault sets. The importer sent any unknown key to `api`, so the Nest app received secrets it never used, and one `platform` set was mounted by Postgres, MinIO, Grafana and backup alike.
- Vault mode had no `.env.prod`, so non-secret tuning (log level, OTP limits, hosts) went through Vault too.

## Decision
- The app composes connections from parts in `backend/src/common/config/connections.ts`: `DB_HOST`/`DB_PORT`/`POSTGRES_*`, `<REDIS>_HOST`/`_PORT`/optional `_PASSWORD` for each of the five Redis instances, and `MAIL_HOST`/`_PORT`/`_SECURE`/`_USER`/`_PASSWORD`. No URL var is read. Passwords are URL-encoded or passed as options.
- The Prisma CLI is the only reader of `DATABASE_URL`; `backend/scripts/with-database-url.cjs` composes it from the same parts and runs the command. A unit test keeps the two compositions identical.
- Vault holds secrets only, one set per consumer: `api`, `bandit`, `postgres`, `minio`, `grafana`, `backup`. A shared secret is written to each set that needs it. The AppRole policy lists each set path explicitly. Each compose service mounts only its own set.
- Non-secrets are the committed `backend/env/prod.env`, shipped by `deploy.sh` as `.env.prod`. A key in both the env file and Vault aborts the deploy, because a plain `KEY` beats a rendered `KEY_FILE`.
- `import-dotenv.sh` routes by an explicit table and rejects unknown keys, the removed URL vars and misnamed backup keys.

## Consequences
- One Postgres password source; rotation patches three Vault sets instead of one plus a URL.
- A compromised Grafana or MinIO container sees only its own credentials.
- Hand-edited prod config on the VPS is replaced by reviewed commits; a change is a PR plus a deploy.
- Breaking: every environment (dev, test, CI, staging, loadtest) moves to the new variables, and an existing Vault needs the one-time move in [vault.md](../ops/vault.md).
- A new secret needs a line in `classify()` in `import-dotenv.sh` and, if it is for a new consumer, a set, a policy path and a compose `env_file` entry.
