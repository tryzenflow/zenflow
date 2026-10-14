# mobile

## 0.1.0-beta.9

### Patch Changes

- b675a81: The no-slot prompt is fully translated and its two actions sit side by side, one primary and one glass.
  The splash hint no longer clips, the inbox header matches the sheet, and the month drag preview keeps
  readable text in dark mode. The week time column is wider so 12:00 AM and the drag time fit, the Overdue
  badge sits beside the type, and the offline icon clears once you reconnect. Privacy and terms pages are
  titled Zenflow | Privacy Policy and Zenflow | Terms of Service.
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

- c6a0e0a: Upload limits are now set by environment variables (`UPLOAD_MAX_FILE_BYTES`, `UPLOAD_MAX_FILES_PER_REQUEST`, `UPLOAD_USER_QUOTA_BYTES`) and served by `GET /files/limits`; the per-user storage default rises from 100 to 150 MiB. Settings gains a Storage section with a usage bar (`GET /files/usage`) that warns from 80% and turns red when full. The master key version for new credentials is now `MASTER_KEY_CURRENT_VERSION`, so rotating a key no longer needs a code change. Alerts and dashboards: API readiness probes both blue and green, backup and restore-test alerts no longer fire right after a deploy, and the Grafana panels are packed without gaps.
- Updated dependencies [c6a0e0a]
  - @zenflow/shared@0.1.0-beta.6
  - @zenflow/core@0.1.0-beta.6

## 0.1.0-beta.5

### Minor Changes

- 7576bd1: Offline read-only mode: the calendar cache is warmed for this week and the surrounding months, task details open offline, create/edit/delete are hidden, integrations are greyed out with a red failed-sync style, and there is a dev "Toggle offline" menu item. Notes get a themed audio/video player, a zoomable image/video viewer and offline media placeholders. Link previews load by default, link and audio cards are no longer cut off at the bottom, and the audio speed chip keeps a fixed width so the waveform doesn't shift. In the editor an audio upload is a link like any document and video plays with the default controls; the themed player is view-only. Uploads are capped at 20 MB per file and 100 MB per user, and the too-large toast shows the right size.

### Patch Changes

- 57edeed: Uploaded videos play on iOS: `GET /files/:id` now answers byte-range requests (206) and sends `Content-Length` and `Accept-Ranges`. A file that fails to load says so instead of reading like an offline message.
- f42aca6: Offline polish: the week header's dots come from saved days, the offline toast shows once per spell, the offline glyph is a cloud with a slash, and the tab bar uses the full width when the create button is hidden. Language, timezone, default reminder and notifications can be changed offline and sync on reconnect. Offline media gets a placeholder per type (grey image box, disabled audio player with its waveform, dark video box with a disabled play button). Audio and video uploads are links in the editor and play in the viewer, and documents show as file cards there. A server that is down no longer signs you out (a 401/403 counts only when `/health/ready` is OK), and the profile name can be edited offline and syncs later. Audio shows a progress bar instead of a made-up waveform, and a day never opened takes its tasks from the saved month. The login logo casts an orange shadow and the background gradients drift further and faster. Document cards show the file size under the name.
- 1f9a99c: Mobile: refuse create/edit/delete while offline with a clear toast, announce going offline, give the offline toast a dark-blue cloud-off icon, and describe what "Synced" refreshed.
- 14fe285: Restore the saved light/dark/system theme on launch instead of resetting to light.
  - @zenflow/shared@0.1.0-beta.5
  - @zenflow/core@0.1.0-beta.5

## 0.1.0-beta.4

### Patch Changes

- 8879d7b: The A/B slot pick is only offered when the two times are at least an hour apart, so you no longer choose
  between 9:00 and 9:15. Reminders are armed every minute instead of every five. On mobile, primary-colored
  buttons keep dark text, the active note toolbar icon is readable in dark mode, and the description shows a
  skeleton and fades in instead of snapping.
- 0299acf: Getting started: the spotlight appears instantly, and "Move a task to another day" now points at a future task
  instead of falling back to "Create a task" when the first day of the month held only a lecture or a past task.
  The Month day sheet opens after its state commits and remounts after a drag-out, so it no longer slips behind
  the scrim.
  The task description editor shows its header (title and Done) while it loads, instead of a full-screen skeleton.
  - @zenflow/shared@0.1.0-beta.4
  - @zenflow/core@0.1.0-beta.4

## 0.1.0-beta.3

### Minor Changes

- bf1a2d1: Mobile: the login card is now a transparent frosted-glass panel over the sunrise backdrop. The month view no longer resizes while it loads. Onboarding stays quiet until you finish (no notification toasts mid-flow), the default tags stay ticked when a campus sync adds its own, and turning on notifications no longer hangs without showing the permission prompt. Staging: the Postgres exporter now reads its credentials from `.env.staging`, so `docker compose` no longer warns about unset `POSTGRES_*` variables.

### Patch Changes

- 6423381: Fix stacked and nested session modals (double tap, calendar rendered inside a modal) and the unhandled
  `GO_BACK` error. Faster tab switches, session creation and Settings, and the notification step shows
  progress instead of looking frozen. Uploading to a note hides the template cards, the week header dots no
  longer blank after a create, and moved toasts carry the date and time in the title, including moves from the
  "Move to…" dialog.
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
