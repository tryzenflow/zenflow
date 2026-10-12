---
"backend": patch
"frontend": patch
"mobile": patch
"@zenflow/shared": patch
"@zenflow/core": patch
---

Backups: each backup and restore-test run records whether it succeeded and logs the failing step. A new
Zenflow · Backups Grafana dashboard shows the result, ages, dump size and error lines, and alerts fire
as soon as a run fails instead of after hours of silence.
