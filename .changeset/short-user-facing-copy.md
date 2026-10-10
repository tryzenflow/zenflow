---
"backend": minor
"frontend": minor
"mobile": minor
"@zenflow/shared": minor
"@zenflow/core": minor
---

Shorter, action-driven copy across notifications and toasts. Notifications use a brief title and a short
imperative body (`6 new exams` / `Plan your revision now.`), and the sync-conflict push carries a Reschedule
action on iOS. Mobile toasts now split long single-line messages into a brief title plus a short
description, lead move and schedule toasts with the time, and no longer show "Welcome back" to new users
still onboarding. CI skips the backend tests and API image build on pull requests that don't touch the
backend.
