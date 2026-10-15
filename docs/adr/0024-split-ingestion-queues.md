# ADR-0024: Split ingestion queues

**Status:** Accepted; refines the queue set of [ADR-0007](0007-bullmq-for-notification-queue.md) and the ticker of [ADR-0011](0011-separate-api-worker-processes.md)
**Date:** 2026-10-15
**Issue:** none filed

## Context

- One `portal-fetch` job walked a whole term (about 20 requests) and wrote one digest at the end. A slow or failed week blocked the rest, load could not spread across students, and the cache could only be read for the whole term.
- Connecting a portal queued nothing. The first sync waited for the next one-minute tick.
- DLU profile and marks were never fetched, so the app could not show them.
- The LMS cache kept one fingerprint per course for the last window walked, so fetching the calendar one month at a time would invalidate it on every job.

## Decision

- **Connect queues two jobs:** `portal-profile` and `portal-discovery` (LMS: `lms-discovery`). The discovery job carries its claimed `IngestionSchedule` row, so the watcher does not queue a second one.
- **Watcher every 5 seconds** (`@Interval`, `TICK_INTERVAL_MS = 5000`) replaces the one-minute cron. Batches are still `ceil(population / ticksPerPeriod)`, at least one student, capped by `INGESTION_TICK_MAX_BATCH`.
  - Claim order: never synced first, then least recently synced.
  - A timetable row is claimable only after discovery covered the current semester; an LMS calendar row after any discovery.
- **One job per unit.** A timetable claim becomes one `portal-week` job per remaining ISO week; an LMS claim becomes two `lms-month` jobs (current and next month). Exams stay on `portal-fetch`.
- **Cache first.** A week job reads the week from `PortalSectionOccurrence` when every confirmed section has fresh coverage (`PortalWeekCoverage` or the term-wide watermark), else fetches only that week, records it and fans it out to classmates. A month job does the same per month.
- **Per-window LMS state.** `LmsCourseWindow` (coverage and corroboration per course and month) and `LmsCourseSeen` (a student's last view per course and month) replace `LmsCourse.occurrences*` and `LmsCourseEnrollment.seenFingerprint`, which are no longer read. `UnitTransition` carries its `scope`.
- **Runs.** `SyncRun` and `SyncRunUnit` track a pass. The job that settles the last unit records the schedule outcome (`recordOutcome`, or `releaseClaim` if any unit failed). `SyncRun` rows from a vanished job are closed as failed after 30 minutes and pruned after 7 days.
- **One notice.** Week jobs write silently (`flushDigest({ silent })`, fan-out `silent`). The first week that changes anything raises one notice per run (`SyncRun.notifiedAt` compare-and-set), no counts:
  - `timetable.ready`: "Timetable for semester 1 2026-2027 is available", "You may not see every week yet. We're still syncing." Once per student and term, including classmates reached by fan-out.
  - `timetable.changed`: "Your timetable changed", when only edits or removals were found.
  - A transaction-scoped `pg_try_advisory_xact_lock` guards the write; a job that does not get it skips.
- **Profile and marks.** `portal-profile` fetches `/api/student/info` and `/api/student/getstudyprogram`, then queues `portal-marks` (`/api/student/marks?ctdt=...&loai=SV`). New models `StudentProfile`, `StudyProgram`, `StudentMark`, `StudentTermResult` keep normalised fields only; the marks payload repeats phone and birthday per row and none of it is stored. Marks join to `PortalSection` by `ScheduleStudyUnitID`. `marks.ready` is raised once.
- **API:** `GET /users/me/student`, `GET /users/me/marks` (`StudentResponse`, `StudentMarksResponse` in `@zenflow/shared`). The Settings profile card shows the profile and opens the marks.
- **Roles:** `worker-portal` consumes every `portal-*` queue and `worker-lms` every `lms-*` queue. No new role or compose service.
- **Migrations:** `20261016100000_student_profile_marks_sync_runs`, `20261016110000_lms_course_window_state`. Indexes on existing tables use `CREATE INDEX CONCURRENTLY IF NOT EXISTS`, one statement per migration file, because Prisma runs a file as one implicit transaction.

## Consequences

- A slow or failed week no longer blocks the others. Load spreads across students and weeks, and a classmate's fetch turns their weeks into cache reads.
- A student sees a first timetable within seconds of connecting, not after the next tick, and is told it is still filling in.
- More jobs: a timetable pass is about 20 jobs instead of 1. The watcher counts a timetable claim as 25 slots against `INGESTION_QUEUE_MAX_BACKLOG`.
- Each week job logs in on its own (one login per fetched week, not one per term). Cached weeks make no request. Watch `outbound` login counts after rollout.
- The LMS cache starts cold after migration: first month jobs fetch, then later ones hit.
- The 5 second tick runs a few indexed queries every tick (claims, stale runs, students without a profile). Re-measure watcher load at the next capacity check ([ADR-0015](0015-launch-capacity-estimate.md)).
- Superseded columns stay until a later migration drops them.
