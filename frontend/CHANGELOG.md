# frontend

## 1.0.0-beta.12

### Patch Changes

- 7fef532: Morning brief and evening check-in send at the set time even when a Do Not Disturb block covers the day. The list view opens on today instead of the oldest past day. The list view refreshes after a delete or edit. A tag created in the task form is selected. Success uses the brand lime and the move past deadline warning is yellow. The streak sits next to Getting started.
- Updated dependencies [7fef532]
  - @zenflow/shared@1.0.0-beta.12
  - @zenflow/core@1.0.0-beta.12

## 1.0.0-beta.11

### Major Changes

- b474dc1: First 1.0 beta. Spread a task out as a daily amount until its deadline, and split a total into sittings of nearly equal length. A series can now take up to three sittings a day, so a near deadline no longer reads as not enough time. Onboarding preselects morning, shows an icon per time of day, and places sleep and meals around the hours you focus best. The empty day slot sits at that time too. Skipped sessions fade with a skip mark, search ignores accents, the streak counts only tasks, and marks and timetable notices open without errors.

  Deployments run the split ingestion queues and their workers, and apply the new migrations before starting.

### Minor Changes

- e8d356d: Zenflow moves to usezenflow.com: the API is at `api.usezenflow.com`, the landing and legal pages at the apex, Grafana at `grafana.usezenflow.com`, and mail comes from `no-reply@usezenflow.com`. The old host keeps serving the API for earlier APKs. Mobile and web legal links open the apex.

### Patch Changes

- Updated dependencies [3c5e8da]
- Updated dependencies [b474dc1]
  - @zenflow/shared@1.0.0-beta.11
  - @zenflow/core@1.0.0-beta.11

## 0.1.0-beta.10

### Patch Changes

- @zenflow/shared@0.1.0-beta.10
- @zenflow/core@0.1.0-beta.10

## 0.1.0-beta.9

### Patch Changes

- @zenflow/shared@0.1.0-beta.9
- @zenflow/core@0.1.0-beta.9

## 0.1.0-beta.8

### Minor Changes

- 33e0779: Accounts: production sign-in is limited to `@dlu.edu.vn` emails (`ALLOWED_EMAIL_DOMAINS`, unset elsewhere); existing sessions from other domains stop working and the login screen explains why. The privacy policy and terms of service are now served by the API at `/privacy` and `/terms` in English and Vietnamese, and linked from the login screen. Backups: uploaded files are archived daily (encrypted, to the existing S3 bucket), the Vault snapshot is verified by the restore test, and the Backups dashboard gains Vault and files panels with alerts. New ops guides cover moving to another server, non-root server access and the contact inbox. Mobile: week-view drags start after a hold so scrolling no longer grabs tasks, the link popup is glass and no longer collides with templates, overdue sessions get a badge in the day sheet (which is taller), skip-conflicting now reports unmoved sessions, and the login gradient and a new branded boot screen are animated. Scheduler: a skip-conflicting series move now sees standalone timetable lectures and ignores deleted occurrences. Observability: the "Method actually used" panel counts series and fallback placements.

### Patch Changes

- 5b636e2: New accounts get a display name read from their email instead of "New User" (a student number keeps the placeholder and onboarding asks for a name). Mobile copy no longer uses dashes, middle dots or arrows between ideas and no longer shouts in capitals: sheet hints, settings and time picker labels, and the Continue button on the tags step read as plain sentence-case text, in English and Vietnamese. The getting-started sheet shows Done 3/7 as a badge, with larger Week view and Month view headings and less empty space below. Also fixes the week-view long press crash and smooths the boot screen handoff (softer background, smaller logo).
- Updated dependencies [33e0779]
- Updated dependencies [5b636e2]
  - @zenflow/shared@0.1.0-beta.8
  - @zenflow/core@0.1.0-beta.8

## 0.1.0-beta.7

### Minor Changes

- 7b46c95: Files linked from a note are deleted when no session references them any more: after a session is
  deleted, a series is removed or shrunk, or an edit drops them, while a file shared with another session
  is kept. Mobile deletes files uploaded in a form that is cancelled or saved without them, saves every
  upload as a link (images still render inline when viewing), and the description editor gains undo and
  redo. Timetables sync every 12 hours in production.

### Patch Changes

- 4476823: Backups: each backup and restore-test run records whether it succeeded and logs the failing step. A new
  Zenflow · Backups Grafana dashboard shows the result, ages, dump size and error lines, and alerts fire
  as soon as a run fails instead of after hours of silence.
- Updated dependencies [4476823]
- Updated dependencies [7b46c95]
  - @zenflow/shared@0.1.0-beta.7
  - @zenflow/core@0.1.0-beta.7

## 0.1.0-beta.6

### Patch Changes

- Updated dependencies [c6a0e0a]
  - @zenflow/shared@0.1.0-beta.6
  - @zenflow/core@0.1.0-beta.6

## 0.1.0-beta.5

### Patch Changes

- @zenflow/shared@0.1.0-beta.5
- @zenflow/core@0.1.0-beta.5

## 0.1.0-beta.4

### Patch Changes

- @zenflow/shared@0.1.0-beta.4
- @zenflow/core@0.1.0-beta.4

## 0.1.0-beta.3

### Minor Changes

- bf1a2d1: Mobile: the login card is now a transparent frosted-glass panel over the sunrise backdrop. The month view no longer resizes while it loads. Onboarding stays quiet until you finish (no notification toasts mid-flow), the default tags stay ticked when a campus sync adds its own, and turning on notifications no longer hangs without showing the permission prompt. Staging: the Postgres exporter now reads its credentials from `.env.staging`, so `docker compose` no longer warns about unset `POSTGRES_*` variables.

### Patch Changes

- Updated dependencies [bf1a2d1]
  - @zenflow/shared@0.1.0-beta.3
  - @zenflow/core@0.1.0-beta.3

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
  - @zenflow/core@0.1.0-beta.2

## 0.1.0-beta.1

### Minor Changes

- bc5e9b6: Notes now store file ids and the API signs file URLs at read time; mobile resolves origin-relative file
  refs in notes. Backend moves notifications and ingestion onto BullMQ queues with a runtime kill switch,
  partitions `SessionEvent` monthly, re-cuts the six placement arms, serves the API behind nginx on port 8000
  and disables Swagger in production.

### Patch Changes

- Updated dependencies [bc5e9b6]
  - @zenflow/shared@0.1.0-beta.1
  - @zenflow/core@0.1.0-beta.1

## 0.1.0-beta.0

### Minor Changes

- b0d6516: First beta. Mobile now has a test pyramid (unit, component tests with MSW, Maestro e2e smoke flows)
  with testIDs on key screens, plus CI that builds an Android APK and an iOS simulator app. The whole
  repo moves to a single beta version line managed by changesets.

### Patch Changes

- Updated dependencies [b0d6516]
  - @zenflow/shared@0.1.0-beta.0
  - @zenflow/core@0.1.0-beta.0
