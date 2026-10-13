---
"backend": minor
"frontend": minor
"mobile": minor
"@zenflow/shared": minor
"@zenflow/core": minor
---

Accounts: production sign-in is limited to `@dlu.edu.vn` emails (`ALLOWED_EMAIL_DOMAINS`, unset elsewhere); existing sessions from other domains stop working and the login screen explains why. The privacy policy and terms of service are now served by the API at `/privacy` and `/terms` in English and Vietnamese, and linked from the login screen. Backups: uploaded files are archived daily (encrypted, to the existing S3 bucket), the Vault snapshot is verified by the restore test, and the Backups dashboard gains Vault and files panels with alerts. New ops guides cover moving to another server, non-root server access and the contact inbox. Mobile: week-view drags start after a hold so scrolling no longer grabs tasks, the link popup is glass and no longer collides with templates, overdue sessions get a badge in the day sheet (which is taller), skip-conflicting now reports unmoved sessions, and the login gradient and a new branded boot screen are animated. Scheduler: a skip-conflicting series move now sees standalone timetable lectures and ignores deleted occurrences. Observability: the "Method actually used" panel counts series and fallback placements.
