# ADR-0014: Nightly encrypted Postgres backups to S3, restore-tested

**Status:** accepted
**Date:** 2026-10-09
**Issue:** #137

## Context
- Everything runs on one host and the compose stack has no backup of Postgres. A disk or host loss would lose all student data.
- The database holds integration credentials for student portals, so copies must be encrypted.
- We run the job ourselves (no managed backup) but keep the copies off-host.

## Decision
- A `backup` service in `backend/compose.prod.yml` (image `postgres:18-alpine` plus an S3 client), triggered by a **host systemd timer** (`docker compose run --rm backup`), so it survives redeploys and blue-green switches ([ADR-0013](0013-blue-green-deploy.md)).
- Nightly `pg_dump -Fc` connected **directly** to Postgres, compressed, encrypted with `age` (private key kept offline), uploaded to `s3://<bucket>/zenflow/prod/YYYY/MM/DD/`. Vault storage is snapshotted alongside; MinIO attachments are synced if they live there.
- S3: lifecycle retention (7 daily, 4 weekly, 6 monthly), versioning, and an IAM user limited to put and list so a compromised host cannot delete history. Credentials come through the existing secrets path.
- Verification: a weekly restore into a throwaway container with row-count checks; a success-timestamp and size metric with alerts for "no backup in 26 h" and an unusually small dump.
- Runbook: `docs/ops/backups.md`; scripts in `backend/ops/backup/`.

## Consequences
- RPO is up to 24 h. WAL archiving (WAL-G or pgBackRest to the same bucket) gives point-in-time recovery and is the upgrade path if that is too long.
- Redis is not backed up: sessions are re-creatable through OTP login.
- The age key holder becomes an operational dependency; losing the key makes the backups unreadable.
