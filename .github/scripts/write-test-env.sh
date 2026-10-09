#!/usr/bin/env bash
# Generate backend/.env.test for CI with throwaway, per-run random secrets, so
# no secret-looking value is ever committed (gitleaks-clean) and each run gets
# fresh credentials. Mirrors backend/.env.example; service hosts are the
# GitHub Actions service containers / compose.test.yml published ports.
set -euo pipefail

out="${1:-backend/.env.test}"
rnd() { openssl rand -hex "$1"; }
pg_pass="$(rnd 12)"
s3_secret="$(rnd 16)"

umask 077
cat > "$out" <<ENV
POSTGRES_USER=ci
POSTGRES_PASSWORD=${pg_pass}
POSTGRES_DB=zenflow-test
DATABASE_URL=postgresql://ci:${pg_pass}@localhost:5433/zenflow-test?schema=public
CACHE_URL=redis://localhost:6379
RATE_LIMIT_CACHE_URL=redis://localhost:6380
# QUEUE_REDIS_URL and REDIS_PUBSUB_URL stay unset on purpose: the suites use the
# in-memory queue fallback and in-process SSE events, so no extra Redis is needed.
# The queue e2e suite (test/queue) defaults to compose.test.yml's queue profile
# on 127.0.0.1:7381 (queue) and :7382 (pub/sub) and passes them to its processes.
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
S3_ENDPOINT=http://localhost:9010
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
