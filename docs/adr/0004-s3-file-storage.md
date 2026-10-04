# 0004 — S3-compatible file storage

Status: accepted

## Context
Uploads were written to the API host's disk (`uploads/` volume) and streamed back
from it, tying the API to a single host's volume.

## Decision
- `FilesService` is now a DI token (`FILES_SERVICE`); `S3FilesService` is the only
  implementation (AWS SDK v3, vendor-neutral `S3_*` config). `LocalFilesService` is removed.
- The interface gains `download(id, userId)` so the controller no longer reads disk.
- `File.path` holds the object key (`<userId>/<uuid>`); no schema change.
- The API still proxies downloads (`GET /files/:id`), so URLs embedded in stored
  content and the authenticated-blob clients are unchanged.
- Uploads are buffered by multer to a temp dir, streamed to S3, then removed.
- The bucket is created by infrastructure: the compose `storage` service
  (`alphatran/minio:latest`) creates it before the server starts. The app does
  not create or check it, so there is no startup race to handle in code.
- `remove` now scopes the DB delete by `userId` (it previously did not).

## Migration
`src/files/migrate-to-s3.cli.ts` (compiled into the image) uploads legacy disk files and rewrites `path`
(idempotent). Run it before dropping the `uploads` volume.
