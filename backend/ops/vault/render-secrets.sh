#!/usr/bin/env bash
# Render secrets from Vault into files consumed by the existing *_FILE
# mechanism (backend/src/common/config/file-secrets.ts, docker-entrypoint.sh).
#
#   VAULT_ENV=staging OUT_DIR=/run/zenflow/staging \
#   VAULT_ROLE_ID_FILE=/etc/zenflow/vault/role_id \
#   VAULT_SECRET_ID_FILE=/etc/zenflow/vault/secret_id \
#     render-secrets.sh
#
# For each set in SECRET_SETS (default "api bandit") reads
# secret/zenflow/$VAULT_ENV/<set> and writes, under $OUT_DIR/<set>/:
#   <KEY>        one file per key holding the raw value (no trailing newline)
#   files.env    KEY_FILE=<MOUNT_PATH>/<KEY> lines (not secret) for compose env_file
# OUT_DIR should live on tmpfs (/run/... on Linux) so values never hit disk.
# Needs curl and jq. Logs in with AppRole; nothing secret goes to argv or stdout.
set -euo pipefail

: "${VAULT_ENV:?dev|staging|prod}" "${OUT_DIR:?}"
VAULT_ADDR="${VAULT_ADDR:-http://127.0.0.1:8200}"
ROLE_ID_FILE="${VAULT_ROLE_ID_FILE:-/etc/zenflow/vault/role_id}"
SECRET_ID_FILE="${VAULT_SECRET_ID_FILE:-/etc/zenflow/vault/secret_id}"
SECRET_SETS="${SECRET_SETS:-api bandit}"
# Where each set is mounted inside containers (only used for files.env).
MOUNT_PATH="${MOUNT_PATH:-/run/secrets/zenflow}"
MOUNT=secret
command -v jq >/dev/null && command -v curl >/dev/null || { echo "render-secrets: curl and jq are required" >&2; exit 1; }

vcurl() { # vcurl <token-or-empty> <curl args...>; token goes via stdin config, not argv
  local token="$1"; shift
  if [ -n "$token" ]; then
    printf 'header = "X-Vault-Token: %s"\n' "$token" | curl -fsS --max-time 15 -K - "$@"
  else
    curl -fsS --max-time 15 "$@"
  fi
}

token=$(jq -n --rawfile r "$ROLE_ID_FILE" --rawfile s "$SECRET_ID_FILE" \
  '{role_id: ($r|rtrimstr("\n")), secret_id: ($s|rtrimstr("\n"))}' \
  | vcurl "" -X POST --data @- "$VAULT_ADDR/v1/auth/approle/login" | jq -r '.auth.client_token')
[ -n "$token" ] && [ "$token" != null ] || { echo "render-secrets: AppRole login failed" >&2; exit 1; }

umask 077
parent=$(dirname "$OUT_DIR")
case "$parent" in /|/run|/tmp|/var|/etc) echo "render-secrets: refusing to restrict shared directory $parent" >&2; exit 1;; esac
# Always enforce 700: a pre-existing parent could let other accounts traverse
# into the world-readable rendered files.
mkdir -p "$parent"; chmod 700 "$parent"
tmp=$(mktemp -d "$parent/.render.XXXXXX")
trap 'rm -rf "$tmp"' EXIT

for set in $SECRET_SETS; do
  mkdir -p "$tmp/$set"
  body=$(vcurl "$token" "$VAULT_ADDR/v1/$MOUNT/data/zenflow/$VAULT_ENV/$set") \
    || { echo "render-secrets: cannot read $MOUNT/zenflow/$VAULT_ENV/$set" >&2; exit 1; }
  : > "$tmp/$set/files.env"
  # Key names become env var names; refuse anything else.
  for key in $(printf '%s' "$body" | jq -r '.data.data | keys[]'); do
    [[ "$key" =~ ^[A-Z][A-Z0-9_]*$ ]] || { echo "render-secrets: skipping invalid key name '$key' in $set" >&2; continue; }
    printf '%s' "$body" | jq -j --arg k "$key" '.data.data[$k]' > "$tmp/$set/$key"
    chmod 444 "$tmp/$set/$key" # parent dir is 700 root; containers may run as non-root
    echo "${key}_FILE=$MOUNT_PATH/$key" >> "$tmp/$set/files.env"
  done
  chmod 444 "$tmp/$set/files.env"; chmod 755 "$tmp/$set"
done
chmod 755 "$tmp"

# Replace the whole directory. Running containers keep the old inode, so the deploy
# force-recreates api/migrations/bandit after rendering (they only read at boot).
rm -rf "$OUT_DIR"
mv "$tmp" "$OUT_DIR"
trap - EXIT
echo "rendered ${SECRET_SETS} from $MOUNT/zenflow/$VAULT_ENV into $OUT_DIR"
