#!/bin/sh
# Expand Docker/Kubernetes-style FOO_FILE=/path secrets into FOO before exec.
# The Node app does this itself (src/common/config/file-secrets.ts), but the
# Prisma CLI (`prisma migrate deploy`, run by the migrations service through
# scripts/with-database-url.cjs) never loads that module, so POSTGRES_PASSWORD_FILE
# has to be expanded here before the wrapper composes DATABASE_URL.
# An already-set FOO wins. Values never reach stdout/stderr.
set -eu

for name in $(env | sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)_FILE=.*/\1/p'); do
  eval "path=\${${name}_FILE}"
  [ -n "$path" ] || continue
  # An explicitly set FOO (even empty) wins, matching file-secrets.ts.
  eval "is_set=\${${name}+x}"
  [ -z "$is_set" ] || continue
  if [ ! -r "$path" ]; then
    echo "docker-entrypoint: ${name}_FILE=$path is not readable" >&2
    exit 1
  fi
  value=$(cat "$path")
  # Same trim as file-secrets.ts: $(...) drops the LF, also drop a CR from CRLF.
  value=${value%"$(printf '\r')"}
  export "$name=$value"
done

exec "$@"
