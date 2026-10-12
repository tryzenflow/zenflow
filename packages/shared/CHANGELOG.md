# @zenflow/shared

## 0.1.0-beta.6

### Patch Changes

- c6a0e0a: Upload limits are now set by environment variables (`UPLOAD_MAX_FILE_BYTES`, `UPLOAD_MAX_FILES_PER_REQUEST`, `UPLOAD_USER_QUOTA_BYTES`) and served by `GET /files/limits`; the per-user storage default rises from 100 to 150 MiB. Settings gains a Storage section with a usage bar (`GET /files/usage`) that warns from 80% and turns red when full. The master key version for new credentials is now `MASTER_KEY_CURRENT_VERSION`, so rotating a key no longer needs a code change. Alerts and dashboards: API readiness probes both blue and green, backup and restore-test alerts no longer fire right after a deploy, and the Grafana panels are packed without gaps.

## 0.1.0-beta.5

## 0.1.0-beta.4

## 0.1.0-beta.3

### Minor Changes

- bf1a2d1: Mobile: the login card is now a transparent frosted-glass panel over the sunrise backdrop. The month view no longer resizes while it loads. Onboarding stays quiet until you finish (no notification toasts mid-flow), the default tags stay ticked when a campus sync adds its own, and turning on notifications no longer hangs without showing the permission prompt. Staging: the Postgres exporter now reads its credentials from `.env.staging`, so `docker compose` no longer warns about unset `POSTGRES_*` variables.

## 0.1.0-beta.2

### Minor Changes

- feb7a70: Shorter, action-driven copy across notifications and toasts. Notifications use a brief title and a short
  imperative body (`6 new exams` / `Plan your revision now.`), and the sync-conflict push carries a Reschedule
  action on iOS. Mobile toasts now split long single-line messages into a brief title plus a short
  description, lead move and schedule toasts with the time, and no longer show "Welcome back" to new users
  still onboarding. CI skips the backend tests and API image build on pull requests that don't touch the
  backend.

## 0.1.0-beta.1

### Minor Changes

- bc5e9b6: Notes now store file ids and the API signs file URLs at read time; mobile resolves origin-relative file
  refs in notes. Backend moves notifications and ingestion onto BullMQ queues with a runtime kill switch,
  partitions `SessionEvent` monthly, re-cuts the six placement arms, serves the API behind nginx on port 8000
  and disables Swagger in production.

## 0.1.0-beta.0

### Minor Changes

- b0d6516: First beta. Mobile now has a test pyramid (unit, component tests with MSW, Maestro e2e smoke flows)
  with testIDs on key screens, plus CI that builds an Android APK and an iOS simulator app. The whole
  repo moves to a single beta version line managed by changesets.
