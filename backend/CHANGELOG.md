# backend

## 0.1.0-beta.5

### Patch Changes

- 57edeed: Uploaded videos play on iOS: `GET /files/:id` now answers byte-range requests (206) and sends `Content-Length` and `Accept-Ranges`. A file that fails to load says so instead of reading like an offline message.
- 992225c: `GET /health` now also checks object storage (bucket), the SMTP relay, and the kill-switch and pub/sub Redis when they are configured. `/health/ready` is unchanged.
  - @zenflow/shared@0.1.0-beta.5

## 0.1.0-beta.4

### Patch Changes

- 8879d7b: The A/B slot pick is only offered when the two times are at least an hour apart, so you no longer choose
  between 9:00 and 9:15. Reminders are armed every minute instead of every five. On mobile, primary-colored
  buttons keep dark text, the active note toolbar icon is readable in dark mode, and the description shows a
  skeleton and fades in instead of snapping.
  - @zenflow/shared@0.1.0-beta.4

## 0.1.0-beta.3

### Minor Changes

- bf1a2d1: Mobile: the login card is now a transparent frosted-glass panel over the sunrise backdrop. The month view no longer resizes while it loads. Onboarding stays quiet until you finish (no notification toasts mid-flow), the default tags stay ticked when a campus sync adds its own, and turning on notifications no longer hangs without showing the permission prompt. Staging: the Postgres exporter now reads its credentials from `.env.staging`, so `docker compose` no longer warns about unset `POSTGRES_*` variables.

### Patch Changes

- Updated dependencies [bf1a2d1]
  - @zenflow/shared@0.1.0-beta.3

## 0.1.0-beta.2

### Minor Changes

- feb7a70: Shorter, action-driven copy across notifications and toasts. Notifications use a brief title and a short
  imperative body (`6 new exams` / `Plan your revision now.`), and the sync-conflict push carries a Reschedule
  action on iOS. Mobile toasts now split long single-line messages into a brief title plus a short
  description, lead move and schedule toasts with the time, and no longer show "Welcome back" to new users
  still onboarding. CI skips the backend tests and API image build on pull requests that don't touch the
  backend.

### Patch Changes

- Updated dependencies [feb7a70]
  - @zenflow/shared@0.1.0-beta.2

## 0.1.0-beta.1

### Minor Changes

- bc5e9b6: Notes now store file ids and the API signs file URLs at read time; mobile resolves origin-relative file
  refs in notes. Backend moves notifications and ingestion onto BullMQ queues with a runtime kill switch,
  partitions `SessionEvent` monthly, re-cuts the six placement arms, serves the API behind nginx on port 8000
  and disables Swagger in production.

### Patch Changes

- Updated dependencies [bc5e9b6]
  - @zenflow/shared@0.1.0-beta.1

## 0.1.0-beta.0

### Minor Changes

- b0d6516: First beta. Mobile now has a test pyramid (unit, component tests with MSW, Maestro e2e smoke flows)
  with testIDs on key screens, plus CI that builds an Android APK and an iOS simulator app. The whole
  repo moves to a single beta version line managed by changesets.

### Patch Changes

- Updated dependencies [b0d6516]
  - @zenflow/shared@0.1.0-beta.0
