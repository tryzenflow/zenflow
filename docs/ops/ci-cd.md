# CI/CD

Issue #75. Workflows live in `.github/workflows/`.

| Workflow | Trigger | What it does |
| --- | --- | --- |
| `ci.yml` | every PR (and merge queue) | lint (changed files), typecheck (shared, core, backend, frontend, mobile), unit tests (backend Jest, mobile Vitest, bandit pytest/ruff), Prisma migration drift check, backend e2e on `compose.test.yml`, frontend Playwright e2e, API image build smoke test, gitleaks. A final aggregate job **`CI ok`** is the only check branch protection needs to require. |
| `images.yml` | push to `master` | `build_images.sh` builds `zenflow-api` and `zenflow-bandit`, pushes `ghcr.io/<owner>/<image>:<git-sha>` (+ `:latest`), then deploys that SHA to **staging** automatically. |
| `release.yml` | GitHub Release published (tag `vX.Y.Z`) | Resolves the tag to its commit (must be on `master`), then deploys the **already built** images for that SHA to **production**. Gated by the `production` Environment's required reviewers. No rebuild: what ran in staging is what ships. |
| `deploy.yml` | called by the two above, or run manually | The single deploy entry point (see "Deploy target" below). Manual run = rollback. |
| `audit.yml` | weekly, and PRs touching the lockfile | `pnpm audit`, informational only (never required). |
| `.github/dependabot.yml` | weekly | npm, GitHub Actions, Docker, uv. |

Prisma check: `prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --exit-code` against a throwaway shadow Postgres. It fails if `schema.prisma` has changes without a migration, or if the migration history does not apply cleanly.

Backend e2e and Playwright generate a throwaway `backend/.env.test` with random secrets (`.github/scripts/write-test-env.sh`), so nothing secret-shaped is committed.

## Deploy target (assumption, please confirm)

No hosting target was specified. `scripts/deploy/deploy.sh` assumes the repo's existing model: **docker compose on a Linux host over SSH** (`backend/compose.staging.yml` / `compose.prod.yml`, images pulled from GHCR). It is parameterized; nothing about the host is hard-coded. If you deploy to ECS/Fly/K8s instead, replace the `REMOTE STEPS` block in that script; the image tags, environments, approval gate and rollback procedure stay the same. The frontend deploys separately through Netlify (`frontend/netlify.toml`) and is not part of these workflows.

Deploys are **disabled until configured**: with `DEPLOY_ENABLED` unset, the deploy job logs a warning and skips, so merges do not fail before infrastructure exists.

Compose files now read `ZENFLOW_API_IMAGE` / `ZENFLOW_BANDIT_IMAGE` (defaults keep the old local `build:` behavior).

### GitHub Environments

Create two Environments (Settings, Environments): `staging` (no reviewers) and `production` (required reviewers, deployment branches limited to `master` and tags). Per Environment:

| Kind | Name | Purpose |
| --- | --- | --- |
| var | `DEPLOY_ENABLED` | `true` to turn the deploy on |
| var | `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_PATH` | SSH target; `DEPLOY_PATH` holds `backend/` |
| var | `HEALTHCHECK_URL` | optional URL polled after rollout |
| var | `SECRETS_PROVIDER` | `host` (default), `sops`, or `command` (see [secrets.md](secrets.md)) |
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

Also allow GitHub Actions to create/publish packages (`packages: write` is requested by `images.yml`). Make the GHCR packages readable by the deploy host (or set `REGISTRY_TOKEN`).

## Branch protection (cannot be applied from code)

Settings, Branches, rule for `master`, or run (needs repo admin; "CI ok" must have run at least once so the check name exists):

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

Intent: no direct pushes (PR required), PRs must be up to date and pass `CI ok`, squash-merge only (Settings, General: disable merge commits and rebase merging; matches CONTRIBUTING.md). Also protect tags `v*` (Settings, Rules, Rulesets) so only maintainers can cut releases. `Gitleaks`, `Prisma`, etc. are covered transitively by `CI ok`, so adding or renaming jobs never needs a settings change.

## Releasing to production

1. Merge to `master`; wait for `images.yml` (staging deploy) to go green and verify staging.
2. Create a GitHub Release with tag `vX.Y.Z` on that commit (`gh release create vX.Y.Z --target <sha> --generate-notes`).
3. `release.yml` pauses at the `production` Environment; a reviewer approves; `deploy.yml` rolls out the SHA's images.

## Rollback runbook (redeploy the previous SHA)

Rollback is just a deploy of an older, already-built SHA, which restores the matching compose/proxy config too.

1. Find the last good SHA: the previous successful run of `Images & staging deploy`/`Release (production)`, `git log master`, or on the host `tail -n 5 $DEPLOY_PATH/.deploy-history` (each line records `timestamp sha prev=<previous sha>`).
2. Run it: Actions, **Deploy**, Run workflow, choose the environment and paste the full SHA. Or `gh workflow run deploy.yml -f environment=production -f image_tag=<sha>`. Production still requires reviewer approval; that is intentional but approvers can respond quickly during an incident.
3. Verify (`HEALTHCHECK_URL`, `docker compose ps`, Grafana).
4. If the faulty release shipped a migration: the migrations service only moves forward and `migrate deploy` does not undo anything. Rolling the app back across a destructive migration is unsafe. Prefer "expand/contract" migrations (additive first) so the previous SHA still works against the new schema; otherwise restore from a DB backup or ship a forward fix. Check the migration list between the two SHAs (`git diff --stat <good>..<bad> -- backend/prisma/migrations`) before rolling back.
5. Revert or fix on `master` afterwards so the next merge does not redeploy the bad commit to staging.

## Known gaps

- Existing lint debt (about 32 backend and 5 frontend eslint errors) means `lint` checks only files changed in the PR. Clean up, then switch to a whole-repo lint.
- `frontend/e2e/` does not exist yet; the Playwright job skips itself until specs land.
- The backend e2e suite has not been run in CI yet; first run may need fixes (it was authored against a local `.env.test`).
