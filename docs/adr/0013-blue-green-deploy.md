# ADR-0013: Blue-green deploys with docker compose and nginx over SSH

**Status:** accepted
**Date:** 2026-10-09
**Issue:** #136

## Context
- CD already exists ([docs/ops/ci-cd.md](../ops/ci-cd.md)): `images.yml` builds and deploys the SHA to staging, `release.yml` deploys to production behind reviewers, `deploy.yml` re-run with an older SHA is the rollback, and `scripts/deploy/deploy.sh` drives docker compose over SSH.
- `docker compose up -d` recreates the API in place: a short outage on every deploy, and rollback means another full deploy.
- We have one host, so this buys zero-downtime deploys and fast rollback, not high availability.

## Decision
Two colours of the app tier, blue and green. Each colour is `api` x N plus `bandit` (they move together because the placement contract is versioned, see [ADR-0012](0012-linucb-time-of-day-arms.md)). Postgres, Redis instances, MinIO, Vault, the `worker`, nginx and observability are shared.

`scripts/deploy/deploy.sh` remote steps:
1. Read the active colour from a state file on the host.
2. Pull images; run the one-shot `migrations` job once.
3. Start the idle colour on the new tag (1 replica first to save memory) and health-gate it on its container network (`/health` checks database and Redis, plus a smoke request).
4. Rewrite the nginx upstream include and `nginx -s reload` ([ADR-0010](0010-nginx-replaces-caddy.md)); scale the new colour up.
5. Restart the `worker` on the new tag.
6. Keep the old colour about 10 minutes for an instant flip back, then stop it; append to `.deploy-history`.

Rollback: flip the include back while the old colour is up; otherwise the existing manual `deploy.yml` run.

## Consequences
- Migrations must be backward compatible with the previous release (expand, then contract), because both colours share the database. The arm change wipes `BanditArmState`, so it ships as its own release in a short `maintenance` window ([ADR-0008](0008-redis-topology-and-kill-switch.md)).
- The overlap temporarily doubles the app tier's memory; the host budget ([ADR-0015](0015-launch-capacity-estimate.md)) holds only with observability trimmed.
- Vault secrets are rendered once to the tmpfs `*_FILE` mounts and shared by both colours; the root deploy-user requirement is unchanged.
- Needs a `/health` readiness endpoint and changes to `compose.{prod,staging}.yml`, `deploy.yml` and `docs/ops/ci-cd.md`.
