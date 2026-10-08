# Changesets

Every user-visible change adds a changeset (`pnpm changeset`). backend, frontend, mobile and the
shared packages are one fixed group, so they always release under the same version.

Releases are automated: merging to `master` opens a "version packages" PR; merging that PR tags
`vX.Y.Z-beta.N`, publishes a GitHub pre-release and attaches the Android APK and iOS simulator app.
See [`docs/ops/releasing.md`](../docs/ops/releasing.md).
