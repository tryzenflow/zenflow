# Releasing (beta)

[Changesets](https://github.com/changesets/changesets) manage versions. `backend`, `frontend`, `mobile`, `@zenflow/shared` and `@zenflow/core` share one version in prerelease mode (`beta`, `.changeset/pre.json`), for example `0.1.0-beta.0`.

## Day to day

1. A PR with a user-visible change runs `pnpm changeset`, picks `patch` or `minor`, and writes a one-line summary. Commit the `.changeset/*.md`.
2. Merging to `main` runs [`release-beta.yml`](../../.github/workflows/release-beta.yml). It opens or updates a **"chore: version packages"** PR (bumps `package.json`s, writes `CHANGELOG.md`s, syncs the root version and compose image defaults via `scripts/sync-version.mjs`).
3. Merging that PR publishes a GitHub pre-release `vX.Y.Z-beta.N` with:
   - `zenflow-android.apk`
   - `zenflow-ios-simulator.zip` (a device `.ipa` needs an Apple Developer account, see [mobile/testing.md](../mobile/testing.md#ios-artifact-app-vs-ipa))
   - Notes from `backend/CHANGELOG.md`

   App files build only if `mobile/` or `packages/` changed since the last tag. Otherwise the release has notes only.
4. `publish-public` copies the release to the public [`tryzenflow/releases`](https://github.com/tryzenflow/releases) repo. It skips without `PUBLIC_RELEASES_TOKEN` and can be re-run alone. Keep changeset summaries free of internal detail.

Pre-releases never deploy to production: `release.yml` promotes only non-prerelease releases.

## Setup

- Repo variable `MOBILE_API_URL`: the API the app uses. Without it the build falls back to localhost.
- Secret `PUBLIC_RELEASES_TOKEN`: fine-grained token with Contents read and write on `tryzenflow/releases` only.
- Workflow permissions: "Read and write" and "Allow GitHub Actions to create and approve pull requests".
- PRs from `GITHUB_TOKEN` start no workflows, so the version PR gets no CI. Merge as admin, or give `changesets/action` a PAT or App token if `ci-ok` is required.

## Mobile version

`mobile/app.config.ts` reads `mobile/package.json`. Store builds need `x.y.z`, so `0.1.0-beta.3` ships as version `0.1.0`, build `4`.

## Leave beta

`pnpm changeset pre exit`, then merge a changeset. The next version PR makes a stable release, which `release.yml` deploys.
