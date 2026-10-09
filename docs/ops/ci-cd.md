# CI/CD

For maintainers (issue #75). Workflows live in `.github/workflows/`.

| Workflow | Trigger | What it does |
| --- | --- | --- |
| `ci.yml` | every PR, merge queue | See "CI jobs" below. Final job **`CI ok`** is the only required check. |
| `images.yml` | push to `master` | Builds `zenflow-api` and `zenflow-bandit` (`build_images.sh`), pushes `ghcr.io/<owner>/<image>:<git-sha>` and `:latest`, deploys that SHA to **staging**. |
| `release.yml` | GitHub Release published (tag `vX.Y.Z`) | Resolves the tag to its commit (must be on `master`), deploys the **already built** images for that SHA to **production**. Gated by `production` required reviewers. No rebuild. |
| `deploy.yml` | called by the two above, or manual | Single deploy entry point (see Deploy target). Manual run = rollback. |
| `audit.yml` | weekly, and PRs touching the lockfile | `pnpm audit`; informational, never required. |
| `.github/dependabot.yml` | weekly | npm, GitHub Actions, Docker, uv. |

## CI jobs

- Lint (changed files only), typecheck (shared, core, backend, frontend, mobile).
- Unit tests: backend Jest, mobile Vitest, bandit pytest/ruff.
- Prisma drift, backend e2e (`compose.test.yml`), frontend Playwright e2e.
- API image build smoke test, gitleaks.
- Vault: `docker compose config` for every compose file; Vault absent from dev/test and loopback-only in staging/prod; the `backup` service in staging/prod mounts `vault_data` read-only; `render-secrets.sh` against a throwaway `vault server -dev`; prod Vault config boots.
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

- Deploys are off until `DEPLOY_ENABLED` is set; unset, the job warns and skips.
- Compose files read `ZENFLOW_API_IMAGE` / `ZENFLOW_BANDIT_IMAGE`; defaults keep the local `build:` behaviour.

### GitHub Environments

Create `staging` (no reviewers) and `production` (required reviewers; branches limited to `master` and tags). Per Environment:

| Kind | Name | Purpose |
| --- | --- | --- |
| var | `DEPLOY_ENABLED` | `true` to turn the deploy on |
| var | `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_PATH` | SSH target; `DEPLOY_PATH` holds `backend/`; `DEPLOY_USER` must be `root` when `SECRETS_PROVIDER=vault` |
| var | `HEALTHCHECK_URL` | optional URL polled after rollout |
| var | `SECRETS_PROVIDER` | `host` (default), `sops`, `command`, or `vault` (**`production` Environment only**; `deploy.yml` and `deploy.sh` refuse it for staging; see [secrets.md](secrets.md)) |
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

## Rollback runbook (redeploy the previous SHA)

Rollback is a deploy of an older, already-built SHA. It restores the matching compose and proxy config too.

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
