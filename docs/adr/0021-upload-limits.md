# ADR-0021: Strict upload limits

**Status:** Accepted
**Date:** 2026-10-11
**Extends:** [ADR-0004](0004-s3-file-storage.md)

## Context
Uploads allowed 100 MB x 5 per request and unlimited total storage per user, with nginx accepting 512 MB bodies. One account could fill the bucket.

## Decision
- `@zenflow/shared` exports the default limits (`MAX_UPLOAD_BYTES` 20 MiB per file, `MAX_USER_STORAGE_BYTES` 150 MiB per user, `MAX_UPLOAD_FILES` 5). The backend overrides them with `UPLOAD_MAX_FILE_BYTES`, `UPLOAD_USER_QUOTA_BYTES` and `UPLOAD_MAX_FILES_PER_REQUEST`, and serves the effective values at `GET /files/limits`; mobile fetches them before an upload and falls back to the defaults.
- `POST /files/upload` caps files per request (default 5). Multer enforces the per-file limit (413); `S3FilesService.upload` re-checks it (`File too large`) and sums the user's `File.size` (indexed on `userId`), rejecting with 413 `Storage full` if the total would exceed the quota. Checks run before any S3 write; the existing `finally` removes temp files.
- nginx `client_max_body_size` is 110m on prod and staging (5 x 20 MB plus multipart overhead).
- No schema changes. The quota default moved from 100 to 150 MiB (1000 users x 150 MiB is ~146 GiB worst case on a 200 GB disk, so watch disk usage).

## Consequences
- Existing files above 20 MB, or users already over quota, stay downloadable and deletable; they just cannot upload more.
- The quota check is not atomic: concurrent uploads from one user can overshoot by up to one request.
- Raising a limit means changing the env vars and nginx `client_max_body_size` together.
