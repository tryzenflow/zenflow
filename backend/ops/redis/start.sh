#!/bin/sh
# Start redis-server with a password taken from the environment, for compose.prod.yml.
# REDIS_PASSWORD_VAR names the variable that holds it (e.g. SESSION_REDIS_PASSWORD, rendered
# from Vault into this container only). The password goes into a root-only config file the
# redis user can read, never onto argv, so it is not visible in `ps` or `docker inspect`.
# Refuses to start without a password: a Redis that silently runs open is worse than a down one.
set -eu
var="${REDIS_PASSWORD_VAR:?REDIS_PASSWORD_VAR is not set}"
pw="$(printenv "$var" || true)"
[ -n "$pw" ] || { echo "redis-auth-start: $var is empty; refusing to start without a password" >&2; exit 1; }
# Redis config strings: double-quoted, with \ and " escaped.
esc="$(printf '%s' "$pw" | sed 's/\\/\\\\/g; s/"/\\"/g')"
conf=/tmp/auth.conf
( umask 077; printf 'requirepass "%s"\n' "$esc" > "$conf" )
chown redis "$conf"
# The image entrypoint fixes /data ownership and drops to the redis user.
exec docker-entrypoint.sh redis-server "$conf" "$@"
