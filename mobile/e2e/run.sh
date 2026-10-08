#!/usr/bin/env bash
# Runs the Maestro smoke suite against whatever device/emulator is booted, with
# the app already installed. Needs the API + Mailpit up (see docs/mobile/testing.md).
#   pnpm --filter mobile e2e                # whole suite
#   pnpm --filter mobile e2e flows/06-logout.yaml
set -euo pipefail
cd "$(dirname "$0")"

command -v maestro >/dev/null || { echo "Install Maestro: https://docs.maestro.dev/getting-started/installing-maestro" >&2; exit 1; }

out="${E2E_OUTPUT:-$PWD/results}"
mkdir -p "$out"
target="${1:-flows}"

exec maestro test \
  -e MAILPIT_URL="${MAILPIT_URL:-http://localhost:8025}" \
  --format junit --output "$out/junit.xml" \
  --debug-output "$out/debug" --flatten-debug-output \
  "$target"
