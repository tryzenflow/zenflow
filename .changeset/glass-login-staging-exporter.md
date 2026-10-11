---
"backend": minor
"frontend": minor
"mobile": minor
"@zenflow/shared": minor
"@zenflow/core": minor
---

Mobile: the login card is now a transparent frosted-glass panel over the sunrise backdrop. The month view no longer resizes while it loads. Onboarding stays quiet until you finish (no notification toasts mid-flow), the default tags stay ticked when a campus sync adds its own, and turning on notifications no longer hangs without showing the permission prompt. Staging: the Postgres exporter now reads its credentials from `.env.staging`, so `docker compose` no longer warns about unset `POSTGRES_*` variables.
