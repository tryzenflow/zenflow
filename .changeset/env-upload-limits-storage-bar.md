---
"backend": patch
"mobile": patch
"@zenflow/shared": patch
---

Upload limits are now set by environment variables (`UPLOAD_MAX_FILE_BYTES`, `UPLOAD_MAX_FILES_PER_REQUEST`, `UPLOAD_USER_QUOTA_BYTES`) and served by `GET /files/limits`; the per-user storage default rises from 100 to 150 MiB. Settings gains a Storage section with a usage bar (`GET /files/usage`) that warns from 80% and turns red when full. The master key version for new credentials is now `MASTER_KEY_CURRENT_VERSION`, so rotating a key no longer needs a code change. Alerts and dashboards: API readiness probes both blue and green, backup and restore-test alerts no longer fire right after a deploy, and the Grafana panels are packed without gaps.
