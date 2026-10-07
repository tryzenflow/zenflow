# ADR-0004: S3-compatible file storage

**Status:** Accepted
**Date:** 2026-10-04

## Context
Uploads were written to the API host's disk (`uploads/` volume) and streamed back from it, tying the API to one host's volume.

## Decision
- `FilesService` is a DI token (`FILES_SERVICE`); `S3FilesService` is the only implementation (AWS SDK v3, vendor-neutral `S3_*` config). `LocalFilesService` is removed.
- The interface gains `download(id, userId)`, so the controller no longer reads disk.
- `File.path` holds the object key (`<userId>/<uuid>`); no schema change.
- The API still proxies downloads (`GET /files/:id`), so URLs in stored content and the authenticated-blob clients are unchanged.
- Uploads are buffered by multer to a temp dir, streamed to S3, then removed.
- Infrastructure creates the bucket: the compose `storage` service (`alphatran/minio:latest`) creates it before the server starts. The app neither creates nor checks it, so there is no startup race.
- `remove` scopes the DB delete by `userId` (it previously did not).
- Signed file URLs for embeds (#89): `FILE_URL_SECRET` HMAC, see `backend/src/files/file-url-signer.service.ts`.

## Consequences
- Run `backend/src/files/migrate-to-s3.cli.ts` (compiled into the image) before dropping the `uploads` volume.
- It uploads legacy disk files and rewrites `path`; it is idempotent.
