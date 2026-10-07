#!/usr/bin/env bash
# Generate backend/.env.test for CI with throwaway, per-run random secrets, so
# no secret-looking value is ever committed (gitleaks-clean) and each run gets
# fresh credentials. Mirrors backend/.env.example; service hosts are the
# compose published ports (PG_HOST_PORT/S3_HOST_PORT select the mapping).
set -euo pipefail

out="${1:-backend/.env.test}"
rnd() { openssl rand -hex "$1"; }
pg_pass="$(rnd 12)"
s3_secret="$(rnd 16)"
# Host ports published by the compose file in use. compose.test.yml uses
# 5433/9010; compose.dev.yml uses 5432/9000 (+9001 console).
pg_port="${PG_HOST_PORT:-5433}"
s3_port="${S3_HOST_PORT:-9010}"

umask 077
cat > "$out" <<ENV
POSTGRES_USER=ci
POSTGRES_PASSWORD=${pg_pass}
POSTGRES_DB=zenflow-test
DATABASE_URL=postgresql://ci:${pg_pass}@localhost:${pg_port}/zenflow-test?schema=public
CACHE_URL=redis://localhost:6379
RATE_LIMIT_CACHE_URL=redis://localhost:6380
CORS_ORIGIN=http://localhost:5173
MAIL_TRANSPORT=smtp://localhost:1025
MAIL_FROM=noreply@example.com
SESSION_SECRET=$(rnd 32)
FILE_URL_SECRET=$(rnd 32)
COOKIE_SECURE=false
COOKIE_SAMESITE=lax
MASTER_LMS_ENCRYPTION_KEY_V1=$(rnd 32)
MASTER_PORTAL_ENCRYPTION_KEY_V1=$(rnd 32)
PORTAL_API_KEY=ci-$(rnd 8)
S3_ENDPOINT=http://localhost:${s3_port}
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=ci
S3_SECRET_ACCESS_KEY=${s3_secret}
S3_BUCKET=zenflow-test
INGESTION_ENABLED=false
INGESTION_REQUEST_DELAY_MS=0
OTEL_SDK_DISABLED=true
NODE_ENV=test
ENV
# Mask in logs in case anything echoes them.
if [ -n "${GITHUB_ACTIONS:-}" ]; then
  for v in "$pg_pass" "$s3_secret"; do echo "::add-mask::$v"; done
fi
