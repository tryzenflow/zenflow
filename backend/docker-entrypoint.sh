#!/bin/sh
# Expand Docker/Kubernetes-style FOO_FILE=/path secrets into FOO before exec.
# The Node app does this itself (src/common/config/file-secrets.ts), but the
# Prisma CLI (`prisma migrate deploy`, run by the migrations service) reads
# DATABASE_URL straight from the environment and never loads that module.
# An already-set FOO wins. Values never reach stdout/stderr.
set -eu

for name in $(env | sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)_FILE=.*/\1/p'); do
  eval "path=\${${name}_FILE}"
  eval "current=\${${name}:-}"
  [ -n "$path" ] || continue
  [ -z "$current" ] || continue
  if [ ! -r "$path" ]; then
    echo "docker-entrypoint: ${name}_FILE=$path is not readable" >&2
    exit 1
  fi
  value=$(cat "$path")
  export "$name=$value"
done

exec "$@"
