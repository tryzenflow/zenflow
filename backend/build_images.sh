#!/usr/bin/env sh
# Build the Zenflow API image. The build context is the MONOREPO ROOT because the
# backend depends on the @zenflow/shared workspace package (packages/shared).
set -e
cd "$(dirname "$0")/.."
# Tag with the backend package.json version (compose files pin this exact tag)
# plus latest. Bump the version in backend/package.json on each release.
VERSION="$(node -p "require('./backend/package.json').version")"
docker build -t "zenflow-api:${VERSION}" -t zenflow-api:latest -f backend/Dockerfile .
