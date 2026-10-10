#!/usr/bin/env bash
# One-time migration of a trusted, single-line .env file into Vault KV v2.
#
#   VAULT_ADDR=http://127.0.0.1:8200 VAULT_TOKEN=... VAULT_ENV=prod \
#     ./ops/vault/import-dotenv.sh .env.prod
#
# Imports into secret/zenflow/$VAULT_ENV/{api,bandit,platform}. It does not
# source the dotenv file, print values, or write temporary plaintext files.
# Inspect the resulting key names with --dry-run before importing.
set -euo pipefail

: "${VAULT_ADDR:?}" "${VAULT_TOKEN:?}" "${VAULT_ENV:?dev|staging|prod}"
case "$VAULT_ENV" in dev|staging|prod) ;; *) echo "VAULT_ENV must be dev|staging|prod" >&2; exit 2;; esac
dotenv_file="${1:?usage: import-dotenv.sh .env.prod [--dry-run]}"
dry_run="${2:-}"
[ -r "$dotenv_file" ] || { echo "cannot read $dotenv_file" >&2; exit 2; }
case "$dry_run" in ""|--dry-run) ;; *) echo "unknown option $dry_run" >&2; exit 2;; esac
command -v curl >/dev/null && command -v jq >/dev/null || { echo "import-dotenv: curl and jq are required" >&2; exit 1; }

emit_set() {
  local wanted="$1" line key value target
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line#"${line%%[![:space:]]*}"}"
    [ -z "$line" ] && continue
    [[ "$line" = \#* ]] && continue
    [[ "$line" = export\ * ]] && line="${line#export }"
    [[ "$line" = *=* ]] || { echo "import-dotenv: unsupported line in $dotenv_file" >&2; exit 2; }
    key="${line%%=*}"; value="${line#*=}"
    [[ "$key" =~ ^[A-Z][A-Z0-9_]*$ ]] || { echo "import-dotenv: invalid key $key" >&2; exit 2; }
    value="${value#"${value%%[![:space:]]*}"}"
    case "$value" in
      \"*|\'*)
        # Quoted: take up to the matching quote; only a comment may follow it.
        q="${value:0:1}"; rest="${value:1}"
        [[ "$rest" = *"$q"* ]] || { echo "import-dotenv: unterminated quote for $key" >&2; exit 2; }
        tail="${rest#*"$q"}"; value="${rest%%"$q"*}"
        tail="${tail#"${tail%%[![:space:]]*}"}"
        [ -z "$tail" ] || [[ "$tail" = \#* ]] || { echo "import-dotenv: unsupported text after quoted value for $key" >&2; exit 2; } ;;
      *)
        # Unquoted: an inline comment starts at whitespace followed by '#'.
        value="${value%%[[:space:]]#*}"
        value="${value%"${value##*[![:space:]]}"}" ;;
    esac
    target=api
    case "$key" in
      POSTGRES_*|BACKUP_*) target=platform ;;
      S3_ACCESS_KEY_ID|S3_SECRET_ACCESS_KEY|S3_BUCKET) target="api platform" ;;
      GRAFANA_ADMIN_PASSWORD) key=GF_SECURITY_ADMIN_PASSWORD; target=platform ;;
      GRAFANA_SMTP_PASSWORD) key=GF_SMTP_PASSWORD; target=platform ;;
      BANDIT_SERVICE_TOKEN) target="api bandit" ;;
    esac
    [[ " $target " = *" $wanted "* ]] && printf '%s\0%s\0' "$key" "$value"
  done < "$dotenv_file"
  return 0
}

payload_for() {
  emit_set "$1" | jq -Rs '
    split("\u0000") | .[:-1] as $pairs |
    reduce range(0; $pairs | length; 2) as $i ({}; .[$pairs[$i]] = $pairs[$i + 1]) |
    {data: .}
  '
}

put_set() {
  local set="$1" payload
  payload="$(payload_for "$set")"
  printf '%s' "$payload" | jq -e '.data | length > 0' >/dev/null || return 0
  if [ "$dry_run" = --dry-run ]; then
    printf '%s: ' "$set"
    printf '%s' "$payload" | jq -r '.data | keys[]' | paste -sd, -
    return 0
  fi
  exec 3<<<"header = \"X-Vault-Token: $VAULT_TOKEN\""
  printf '%s' "$payload" | curl -fsS --max-time 15 -K /dev/fd/3 \
    -H 'Content-Type: application/json' -X POST --data @- \
    "$VAULT_ADDR/v1/secret/data/zenflow/$VAULT_ENV/$set" >/dev/null
  exec 3<&-
  echo "imported $set"
}

put_set api
put_set bandit
put_set platform
