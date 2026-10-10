# CI/CD

For maintainers (issue #75). Workflows live in `.github/workflows/`.

| Workflow | Trigger | What it does |
| --- | --- | --- |
| `ci.yml` | every PR, merge queue | See "CI jobs" below. Final job **`CI ok`** is the only required check. |
| `images.yml` | push to `master` | Builds `zenflow-api` and `zenflow-bandit` (`build_images.sh`), pushes `ghcr.io/<owner>/<image>:<git-sha>` and `:latest`, deploys that SHA to **staging**. |
| `release.yml` | GitHub Release published (tag `vX.Y.Z`) | Resolves the tag to its commit (must be on `master`), deploys the **already built** images for that SHA to **production**. Gated by `production` required reviewers. No rebuild. |
| `deploy.yml` | called by the two above, or manual | Single deploy entry point (see Deploy target). Manual run = rollback (`mode=flip` or an older SHA). |
| `audit.yml` | weekly, and PRs touching the lockfile | `pnpm audit`; informational, never required. |
| `.github/dependabot.yml` | weekly | npm, GitHub Actions, Docker, uv. |

## CI jobs

- Lint (changed files only), typecheck (shared, core, backend, frontend, mobile).
- Unit tests: backend Jest, mobile Vitest, bandit pytest/ruff.
- Prisma drift, backend e2e (`compose.test.yml`), frontend Playwright e2e.
- API image build smoke test, gitleaks.
- Vault: `docker compose config` for every compose file; Vault only in prod (absent from dev, staging and test) and loopback-only; the prod `backup` service mounts `vault_data` read-only; `render-secrets.sh` against a throwaway `vault server -dev` (per-set isolation, explicit policy paths, importer routing and rejections, `backend/env/prod.env` holds no secret); prod Vault config boots.
- Agents: `.claude/` and `.codex/` match `.agents/` (`node scripts/sync-agents.mjs --check`), hook tests, ownership check.

Prisma check, against a throwaway shadow Postgres:

```bash
prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --exit-code
```

It fails on schema changes without a migration, or a migration history that does not apply cleanly.

The multi-process queue e2e (`backend-e2e-queue`, compose profile `queue`) runs on every PR, like the other e2e jobs.

Backend e2e and Playwright generate a throwaway `backend/.env.test` with random secrets (`.github/scripts/write-test-env.sh`). Nothing secret-shaped is committed.

## Deploy target

- `scripts/deploy/deploy.sh` assumes docker compose on a Linux host over SSH (`backend/compose.{staging,prod}.yml`, images from GHCR).
- Nothing about the host is hard-coded; for ECS/Fly/K8s replace its `REMOTE STEPS` block.
- The frontend deploys separately through Netlify (`frontend/netlify.toml`).

### Blue-green flow ([ADR-0013](../adr/0013-blue-green-deploy.md))

The app tier runs as two colours, `api-{blue,green}` (x N) + `bandit-{blue,green}`. Postgres, Redis, the queue roles (`watcher`, `worker-*`), nginx and observability are shared. Host state is in `$DEPLOY_PATH/backend/state/` (`active`, `upstream.api.conf`, `images.env`, `reaper.pid`); never edit it by hand.

`deploy.sh` on the host:

1. Read the active colour; pull the new tag; run `migrations` once.
2. Start the idle colour at 1 replica; gate on its healthcheck (`GET /api/v1/health/ready`: Postgres + Redis) and a smoke `GET /api/v1/health` (all dependencies, including its bandit). A failure stops the idle colour and leaves the active one untouched.
3. Memory guard: abort if the host cannot fit the full overlap plus `MIN_FREE_MB`.
4. Point nginx at the new colour (`nginx -t`, reload), scale it to full size, reload again.
5. Recreate `watcher` / `worker-*` on the new tag.
6. Stop the old colour after `OLD_COLOUR_TTL`.

| Var (per Environment, optional) | Default | Purpose |
| --- | --- | --- |
| `OLD_COLOUR_TTL` | `600` | Seconds the previous colour stays up for a flip back; `0` stops it at once |
| `MIN_FREE_MB` | `512` | Available memory that must remain after the new colour is at full size |

- Migrations must be backward compatible with the previous release (expand, then contract): both colours share the database.
- The first deploy on this layout replaces the old single `api` / `bandit` services and has a short outage. Later deploys do not.
- `./killswitch` and `docker compose exec` need the colour: `cat backend/state/active`.
- The queue roles follow the active colour's bandit; do not `up` them by hand without `ZENFLOW_ACTIVE_COLOUR`.

### Rehearsal on staging (acceptance for #136)

1. Run the 1x k6 scenario ([loadtest/README.md](../../loadtest/README.md)) against staging and deploy during it: `http_req_failed` must stay 0 across the flip.
2. Run **Deploy** with `mode=flip` inside the TTL: instant, no errors.
3. During the overlap watch the deploy log's `docker stats` and `free -m`: peak stays inside the [ADR-0015](../adr/0015-launch-capacity-estimate.md) budget.

- Deploys are off until `DEPLOY_ENABLED` is set; unset, the job warns and skips.
- Compose files read `ZENFLOW_API_IMAGE` / `ZENFLOW_BANDIT_IMAGE`; defaults keep the local `build:` behaviour.

### GitHub Environments

Create `staging` (no reviewers) and `production` (required reviewers; branches limited to `master` and tags). Per Environment:

| Kind | Name | Purpose |
| --- | --- | --- |
| var | `DEPLOY_ENABLED` | `true` to turn the deploy on |
| var | `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_PATH` | SSH target; `DEPLOY_PATH` holds `backend/`; with `SECRETS_PROVIDER=vault`, `DEPLOY_USER` must own the AppRole creds and `/run/zenflow` (root works; or a user you `chown` them to, see [vault.md](vault.md)) |
| var | `HEALTHCHECK_URL` | optional URL polled after rollout |
| var | `SECRETS_PROVIDER` | `host` (default), `sops`, `command`, or `vault` (**`production` Environment only**; Vault renders the prod secrets (one set per consumer) from tmpfs, and the committed non-secret `backend/env/prod.env` is shipped as `.env.prod`; `deploy.yml` and `deploy.sh` refuse it for staging; see [secrets.md](secrets.md)) |
| var | `VAULT_ADDR`, `VAULT_ROLE_ID_FILE`, `VAULT_SECRET_ID_FILE` | only for `vault` (production only); paths/addr as seen **on the deploy host** (defaults `http://127.0.0.1:8200`, `/etc/zenflow/vault/{role_id,secret_id}`). The AppRole creds live on the host, not in GitHub |
| secret | `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS` | deploy key and pinned host key (`ssh-keyscan`) |
| secret | `SOPS_AGE_KEY` | only for `sops` |
| secret | `SECRETS_COMMAND` | only for `command` |

```bash
# Environments (replace <reviewer-user-id> with `gh api users/<login> --jq .id`)
gh api -X PUT repos/tryzenflow/zenflow/environments/staging
gh api -X PUT repos/tryzenflow/zenflow/environments/production \
  -f 'reviewers[][type]=User' -F 'reviewers[][id]=<reviewer-user-id>' \
  -F 'deployment_branch_policy[protected_branches]=false' \
  -F 'deployment_branch_policy[custom_branch_policies]=true'
gh variable set DEPLOY_ENABLED --env staging --body true
```

- Allow GitHub Actions to publish packages (`images.yml` requests `packages: write`).
- Make the GHCR packages readable by the deploy host, or set `REGISTRY_TOKEN`.

## Branch protection (cannot be applied from code)

Needs repo admin, and `CI ok` must have run once so the check name exists. Settings, Branches, rule for `master`, or:

```bash
gh api -X PUT repos/tryzenflow/zenflow/branches/master/protection --input - <<'JSON'
{
  "required_status_checks": { "strict": true, "contexts": ["CI ok"] },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1,
    "dismiss_stale_reviews": true
  },
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_conversation_resolution": true
}
JSON
```

Result: PR required, up to date, `CI ok` green, linear history.

- Squash-merge only: Settings, General, disable merge commits and rebase merging.
- Protect tags `v*`: Settings, Rules, Rulesets.
- Other jobs roll up into `CI ok`, so adding or renaming jobs needs no settings change.

## Releasing to production

1. Merge to `master`; wait for `images.yml` (staging deploy) to go green and verify staging.
2. Create a GitHub Release with tag `vX.Y.Z` on that commit (`gh release create vX.Y.Z --target <sha> --generate-notes`).
3. `release.yml` pauses at the `production` Environment; a reviewer approves; `deploy.yml` rolls out the SHA's images.

## Rollback runbook

- **Old colour still up** (within `OLD_COLOUR_TTL`): Actions, **Deploy**, `mode=flip`, pick the environment (`gh workflow run deploy.yml -f environment=production -f mode=flip`). It checks the old colour is healthy, repoints nginx and the queue roles, and keeps the bad colour up for another TTL. Production still needs reviewer approval.
- **Otherwise**: redeploy the previous SHA, below. It restores the matching compose and proxy config too.

### Redeploy the previous SHA

1. Find the last good SHA: previous green `Images & staging deploy` / `Release (production)` run, `git log master`, or on the host `tail -n 5 $DEPLOY_PATH/.deploy-history` (lines: `timestamp sha prev=<previous sha>`).
2. Run it: Actions, **Deploy**, Run workflow, pick the environment, paste the full SHA. Or `gh workflow run deploy.yml -f environment=production -f image_tag=<sha>`. Production still needs reviewer approval.
3. Verify (`HEALTHCHECK_URL`, `docker compose ps`, Grafana).
4. Migrations only move forward; rolling back across a destructive one is unsafe.
   - Check what shipped: `git diff --stat <good>..<bad> -- backend/prisma/migrations`.
   - Prefer expand/contract migrations so the previous SHA still works; otherwise restore a DB backup or ship a forward fix.
5. Revert or fix on `master` afterwards so the next merge does not redeploy the bad commit to staging.

## Known gaps

- Lint debt (about 32 backend, 5 frontend eslint errors): `lint` checks only changed files. Clean up, then lint the whole repo.
- `frontend/e2e/` does not exist yet; the Playwright job skips itself until specs land.
- The backend e2e suite was authored against a local `.env.test`; its first CI run may need fixes.
