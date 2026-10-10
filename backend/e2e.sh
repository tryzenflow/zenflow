#!/usr/bin/env bash
# Local backend e2e: the same stack CI uses (see .github/workflows/ci.yml, backend-e2e).
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env.test ] || ../.github/scripts/write-test-env.sh .env.test
docker compose --profile queue --profile bandit -f compose.test.yml up -d --build
until docker exec zenflow-test-db pg_isready -U ci -d zenflow-test; do sleep 2; done
pnpm exec dotenv -e .env.test -- node scripts/with-database-url.cjs prisma migrate deploy
pnpm test:e2e
