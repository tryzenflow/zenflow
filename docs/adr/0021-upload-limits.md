# ADR-0021: Strict upload limits

**Status:** Accepted
**Date:** 2026-10-11
**Extends:** [ADR-0004](0004-s3-file-storage.md)

## Context
Uploads allowed 100 MB x 5 per request and unlimited total storage per user, with nginx accepting 512 MB bodies. One account could fill the bucket.

## Decision
- `@zenflow/shared` exports `MAX_UPLOAD_BYTES` (10 MiB per file) and `MAX_USER_STORAGE_BYTES` (30 MiB per user); both apps import them.
- `POST /files/upload` keeps the 5-file cap. Multer enforces the per-file limit (413); `S3FilesService.upload` re-checks it (`File too large`) and sums the user's `File.size` (indexed on `userId`), rejecting with 413 `Storage full` if the total would exceed the quota. Checks run before any S3 write; the existing `finally` removes temp files.
- nginx `client_max_body_size` is 60m on prod and staging (5 x 10 MB plus multipart overhead).
- No schema or env changes.

## Consequences
- Existing files above 10 MB, or users already over quota, stay downloadable and deletable; they just cannot upload more.
- The quota check is not atomic: concurrent uploads from one user can overshoot by up to one request.
- Raising a limit means changing the shared constants and nginx together.
