# CI/CD

For maintainers (issue #75). Workflows live in `.github/workflows/`.

| Workflow | Trigger | Does |
| --- | --- | --- |
| `ci.yml` | Every PR, merge queue | [CI jobs](#ci-jobs). Final job **`CI ok`** is the only required check |
| `images.yml` | Push to `main` | Builds `zenflow-api` and `zenflow-bandit`, pushes `ghcr.io/<owner>/<image>:<git-sha>` and `:latest`, deploys that SHA to staging |
| `release.yml` | GitHub Release published (`vX.Y.Z`) | Deploys the already built images for the tag's commit (must be on `main`) to production. Needs `production` reviewers. No rebuild |
| `deploy.yml` | Called by the two above, or manual | Single deploy entry point. Manual run is a rollback (`mode=flip` or an older SHA) |
| `audit.yml` | Weekly, PRs touching the lockfile | `pnpm audit`. Informational |
| `.github/dependabot.yml` | Weekly | npm, GitHub Actions, Docker, uv |

## CI jobs

- Lint (changed files), typecheck (shared, core, backend, frontend, mobile).
- Unit tests: backend Jest, mobile Vitest, bandit pytest and ruff.
- Prisma drift, backend e2e (`compose.test.yml`), queue e2e (`backend-e2e-queue`), frontend Playwright e2e.
- API image build smoke test, gitleaks.
- Vault: `docker compose config` for every compose file, `render-secrets.sh` against a throwaway dev server, prod Vault config boots.
- Agents: `.claude/` and `.codex/` match `.agents/` (`node scripts/sync-agents.mjs --check`), hook tests, ownership check.

Prisma drift fails on a schema change without a migration:

```bash
prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --exit-code
```

E2E jobs generate a throwaway `backend/.env.test` with random secrets (`.github/scripts/write-test-env.sh`).

## Deploy

- `scripts/deploy/deploy.sh` targets docker compose on a Linux host over SSH (`backend/compose.{staging,prod}.yml`, images from GHCR). For ECS, Fly or K8s replace its `REMOTE STEPS` block.
- The frontend deploys through Netlify (`frontend/netlify.toml`).
- Deploys stay off until `DEPLOY_ENABLED` is set.
- Compose reads `ZENFLOW_API_IMAGE` and `ZENFLOW_BANDIT_IMAGE`. Defaults build locally.

### Blue-green ([ADR-0013](../adr/0013-blue-green-deploy.md))

`api-{blue,green}` and `bandit-{blue,green}` alternate. Postgres, Redis, queue roles (`watcher`, `worker-*`), nginx and observability are shared. Host state is `$DEPLOY_PATH/backend/state/` (`active`, `upstream.api.conf`, `images.env`, `reaper.pid`). Do not edit it.

`deploy.sh` on the host:

1. Read the active colour, pull the new tag, run `migrations` once.
2. Start the idle colour at 1 replica. Gate on `GET /api/v1/health/ready` and a smoke `GET /api/v1/health`. On failure, stop it and leave the active colour untouched.
3. Abort if memory cannot fit the overlap plus `MIN_FREE_MB`.
4. Point nginx at the new colour (`nginx -t`, reload), scale up, reload.
5. Recreate `watcher` and `worker-*` on the new tag.
6. Stop the old colour after `OLD_COLOUR_TTL`.

| Var (per Environment, optional) | Default | Purpose |
| --- | --- | --- |
| `OLD_COLOUR_TTL` | `600` | Seconds the old colour stays up for a flip back. `0` stops it now |
| `MIN_FREE_MB` | `512` | Memory that must remain after the new colour is full size |

- Migrations must work with the previous release (expand, then contract).
- The first deploy on this layout has a short outage.
- `./killswitch` and `docker compose exec` need the colour: `cat backend/state/active`.
- Do not `up` queue roles by hand without `ZENFLOW_ACTIVE_COLOUR`.

Staging rehearsal (#136):

1. Run the 1x k6 scenario ([loadtest/README.md](../../loadtest/README.md)) and deploy during it. `http_req_failed` stays 0.
2. Run **Deploy** with `mode=flip` inside the TTL. Expect no errors.
3. Watch `docker stats` and `free -m`. Peak stays inside the [ADR-0015](../adr/0015-launch-capacity-estimate.md) budget.

### GitHub Environments

Create `staging` (no reviewers) and `production` (required reviewers, branches limited to `main` and tags).

| Kind | Name | Purpose |
| --- | --- | --- |
| var | `DEPLOY_ENABLED` | `true` turns deploys on |
| var | `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_PATH` | SSH target. `DEPLOY_PATH` holds `backend/`. Use a non-root user ([server-access.md](server-access.md)) |
| var | `HEALTHCHECK_URL` | Optional URL polled after rollout |
| var | `SECRETS_PROVIDER` | `host` (default), `sops`, `command`, or `vault` (production only). See [secrets.md](secrets.md) |
| var | `VAULT_ADDR`, `VAULT_ROLE_ID_FILE`, `VAULT_SECRET_ID_FILE` | `vault` only, as seen on the deploy host. Defaults: `http://127.0.0.1:8200`, `/etc/zenflow/vault/{role_id,secret_id}` |
| secret | `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS` | Deploy key and pinned host key (`ssh-keyscan`) |
| secret | `SOPS_AGE_KEY` | `sops` only |
| secret | `SECRETS_COMMAND` | `command` only |

```bash
# <reviewer-user-id>: gh api users/<login> --jq .id
gh api -X PUT repos/tryzenflow/zenflow/environments/staging
gh api -X PUT repos/tryzenflow/zenflow/environments/production \
  -f 'reviewers[][type]=User' -F 'reviewers[][id]=<reviewer-user-id>' \
  -F 'deployment_branch_policy[protected_branches]=false' \
  -F 'deployment_branch_policy[custom_branch_policies]=true'
gh variable set DEPLOY_ENABLED --env staging --body true
```

- Allow Actions to publish packages (`images.yml` needs `packages: write`).
- Make GHCR packages readable by the deploy host, or set `REGISTRY_TOKEN`.

## Branch protection

Needs repo admin. Run after `CI ok` has run once. Or use Settings, Branches.

```bash
gh api -X PUT repos/tryzenflow/zenflow/branches/main/protection --input - <<'JSON'
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

- Squash-merge only: disable merge commits and rebase merging in Settings, General.
- Protect tags `v*` in Settings, Rules.
- New jobs roll up into `CI ok`, so no settings change.

## Release

1. Merge to `main`, wait for `images.yml`, verify staging.
2. `gh release create vX.Y.Z --target <sha> --generate-notes`.
3. `release.yml` pauses at `production`. A reviewer approves, `deploy.yml` rolls out.

## Roll back

**Old colour still up** (within `OLD_COLOUR_TTL`):

```bash
gh workflow run deploy.yml -f environment=production -f mode=flip
```

It checks the old colour, repoints nginx and the queue roles, and keeps the bad colour up for another TTL. Production still needs approval.

**Otherwise**, redeploy the previous SHA:

1. Find the last good SHA: previous green run, `git log main`, or `tail -n 5 $DEPLOY_PATH/.deploy-history` (`timestamp sha prev=<sha>`).
2. `gh workflow run deploy.yml -f environment=production -f image_tag=<sha>`. Approve.
3. Verify with `HEALTHCHECK_URL`, `docker compose ps` and Grafana.
4. Migrations only move forward. Check `git diff --stat <good>..<bad> -- backend/prisma/migrations`. Prefer expand and contract, otherwise restore a DB backup or ship a forward fix.
5. Revert or fix on `main` so staging does not redeploy the bad commit.

## Known gaps

- Lint debt (about 32 backend, 5 frontend errors). `lint` checks changed files only.
- `frontend/e2e/` is missing. The Playwright job skips until specs land.
