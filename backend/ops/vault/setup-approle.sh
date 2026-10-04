#!/bin/sh
# Create/refresh the read-only policy and AppRole for one environment, and
# optionally mint a fresh secret_id (this is also the secret_id rotation step).
#
#   VAULT_ADDR=... VAULT_TOKEN=... ENV_NAME=staging \
#     sh setup-approle.sh [--role-id-file PATH] [--secret-id-file PATH]
#
# Needs the `vault` CLI and a token allowed to manage policies/auth (an admin
# token; do not use the root token for anything but bootstrap). Idempotent.
# role_id is an identifier (not secret) and goes to --role-id-file; the
# secret_id is written ONLY to --secret-id-file (mode 600), never to stdout.
set -eu

: "${VAULT_ADDR:?}" "${VAULT_TOKEN:?}" "${ENV_NAME:?dev|staging|prod}"
case "$ENV_NAME" in dev|staging|prod) ;; *) echo "ENV_NAME must be dev|staging|prod" >&2; exit 2;; esac
here=$(cd "$(dirname "$0")" && pwd)
role="zenflow-api-$ENV_NAME"
role_id_file=""; secret_id_file=""
while [ $# -gt 0 ]; do
  case "$1" in
    --role-id-file) role_id_file=$2; shift 2;;
    --secret-id-file) secret_id_file=$2; shift 2;;
    *) echo "unknown arg $1" >&2; exit 2;;
  esac
done

vault auth list -format=json | grep -q '"approle/"' || vault auth enable approle >/dev/null
sed "s/__ENV__/$ENV_NAME/g" "$here/policy.hcl" | vault policy write "$role" - >/dev/null

# Short-lived tokens; secret_id valid 30 days (rotate before expiry); usable
# any number of times because every deploy and reboot logs in again.
vault write "auth/approle/role/$role" \
  token_policies="$role" token_ttl=10m token_max_ttl=30m \
  secret_id_ttl=720h secret_id_num_uses=0 bind_secret_id=true >/dev/null

if [ -n "$role_id_file" ]; then
  (umask 077; vault read -field=role_id "auth/approle/role/$role/role-id" > "$role_id_file")
  chmod "${CRED_FILE_MODE:-600}" "$role_id_file"
fi
if [ -n "$secret_id_file" ]; then
  (umask 077; vault write -f -field=secret_id "auth/approle/role/$role/secret-id" > "$secret_id_file")
  chmod "${CRED_FILE_MODE:-600}" "$secret_id_file"
fi
echo "approle $role ready"
