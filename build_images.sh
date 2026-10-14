#!/usr/bin/env sh
# Build (and optionally push) the Zenflow images. Used locally and by
# .github/workflows/images.yml so both produce identical tags.
#
#   REGISTRY  image prefix, e.g. ghcr.io/tryzenflow  (empty = local-only names)
#   TAG       primary tag (default: backend/package.json version; CI passes the git SHA)
#   PUSH      1 = also `docker push` every tag (requires a prior `docker login`)
#   LATEST    1 (default) also tag :latest
#   IMAGES    space-separated subset of "api bandit" to build (default: both)
set -eu

VERSION="$(node -p "require('./backend/package.json').version")"
TAG="${TAG:-$VERSION}"
PUSH="${PUSH:-0}"
LATEST="${LATEST:-1}"
PREFIX="${REGISTRY:+${REGISTRY%/}/}"

build() {
  name="$1"; context="$2"; dockerfile="$3"
  image="${PREFIX}${name}"
  set -- -t "${image}:${TAG}"
  [ "$LATEST" = "1" ] && set -- "$@" -t "${image}:latest"
  docker build "$@" -f "$dockerfile" "$context"
  if [ "$PUSH" = "1" ]; then
    docker push "${image}:${TAG}"
    [ "$LATEST" = "1" ] && docker push "${image}:latest"
  fi
  return 0
}

# Build context for backend/Dockerfile is the monorepo root.
IMAGES="${IMAGES:-api bandit}"
for img in $IMAGES; do
  case "$img" in
    api) build zenflow-api . backend/Dockerfile ;;
    bandit) build zenflow-bandit services/bandit services/bandit/Dockerfile ;;
    *) echo "unknown image: $img" >&2; exit 1 ;;
  esac
done
