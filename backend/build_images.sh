#!/usr/bin/env sh
# Build the Zenflow API image. The build context is the MONOREPO ROOT because the
# backend depends on the @zenflow/shared workspace package (packages/shared).
set -e
cd "$(dirname "$0")/.."
docker build -t zenflow-api:latest -f backend/Dockerfile .
