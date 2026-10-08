# Releasing (beta)

Versioning is managed by [changesets](https://github.com/changesets/changesets). `backend`, `frontend`,
`mobile`, `@zenflow/shared` and `@zenflow/core` are one **fixed** group: they always share a version, and
the repo is in prerelease mode (`beta`, see `.changeset/pre.json`), so versions look like `0.1.0-beta.0`.

## Day to day

1. A PR with a user-visible change runs `pnpm changeset`, picks the bump (`patch` / `minor`) and writes a
   one-line summary. Commit the generated `.changeset/*.md` with the PR.
2. Merging to `master` runs [`release-beta.yml`](../../.github/workflows/release-beta.yml), which opens or
   updates a **"chore: version packages"** PR (bumps every `package.json`, writes each package's
   `CHANGELOG.md`, syncs the root version and compose image defaults via `scripts/sync-version.mjs`).
3. Merging that PR publishes a GitHub **pre-release** `vX.Y.Z-beta.N` with:
   - `zenflow-android.apk`
   - `zenflow-ios-simulator.zip` (simulator `.app`; a device `.ipa` needs an Apple Developer account, see
     [`docs/mobile/testing.md`](../mobile/testing.md#ios-artifact-app-vs-ipa))
   - notes taken from `backend/CHANGELOG.md`.

Pre-releases never trigger the production deploy: `release.yml` only promotes non-prerelease releases.

## Setup it relies on

- Repo variable `MOBILE_API_URL`: the API the published app talks to. Without it the build falls back to a
  localhost URL (a warning is logged) and the artifacts won't reach a real API.
- Workflow permission "Read and write" plus "Allow GitHub Actions to create and approve pull requests".
- PRs opened by `GITHUB_TOKEN` don't start other workflows, so the version PR gets no CI run. Merge it as
  an admin or use a PAT/GitHub App token for `changesets/action` if `ci-ok` is a required check.

## Mobile version

`mobile/app.config.ts` reads `mobile/package.json`. Store builds need plain `x.y.z`, so `0.1.0-beta.3`
ships as version `0.1.0` with build number / version code `4`.

## Leaving beta

`pnpm changeset pre exit`, then merge a changeset; the next version PR produces a stable release (and
`release.yml` will then deploy it).
