#!/usr/bin/env bash
# Parameterized deploy of a Zenflow image tag to one environment.
#
# THIS IS A TEMPLATE. The deploy target was not specified, so this assumes the
# repo's existing model (docker compose on a Linux host: backend/compose.<env>.yml)
# reached over SSH. Everything target-specific is driven by variables; swap the
# "REMOTE STEPS" block (or this whole script) if you move to ECS/Fly/K8s -- the
# workflow, image tags, secrets plumbing and rollback story stay the same.
#
# Required env (set as GitHub Environment vars/secrets, see docs/ops/ci-cd.md):
#   DEPLOY_ENV        staging | prod          (compose.<env>.yml / .env.<env>)
#   IMAGE_TAG         git SHA of the images to run (what images.yml pushed)
#   REGISTRY          e.g. ghcr.io/tryzenflow
#   DEPLOY_HOST       ssh host
#   DEPLOY_USER       ssh user
#   DEPLOY_PATH       checkout dir on the host that contains backend/
# Optional:
#   SECRETS_PROVIDER  host (default) | sops | command | vault   -- see docs/ops/secrets.md (vault: prod only)
#   VAULT_ROLE_ID_FILE / VAULT_SECRET_ID_FILE  for vault: AppRole creds ON THE HOST
#                     (default /etc/zenflow/vault/{role_id,secret_id}, root-only)
#   VAULT_ADDR        for vault: address as seen from the host (default http://127.0.0.1:8200)
#   SOPS_FILE         for sops: path to the encrypted dotenv (default backend/secrets/<env>.env.enc)
#   SECRETS_COMMAND   for command: prints a dotenv document on stdout
#   REGISTRY_USER / REGISTRY_TOKEN  to `docker login` on the host (omit if public/pre-logged-in)
#   HEALTHCHECK_URL   polled from the runner after the rollout
#   DRY_RUN=1         print the plan, touch nothing
set -euo pipefail

: "${DEPLOY_ENV:?}" "${IMAGE_TAG:?}" "${REGISTRY:?}"
: "${DEPLOY_HOST:?}" "${DEPLOY_USER:?}" "${DEPLOY_PATH:?}"
SECRETS_PROVIDER="${SECRETS_PROVIDER:-host}"
case "$DEPLOY_ENV" in staging|prod) ;; *) echo "DEPLOY_ENV must be staging or prod" >&2; exit 2;; esac
if [ "$SECRETS_PROVIDER" = "vault" ] && [ "$DEPLOY_ENV" != "prod" ]; then
  echo "SECRETS_PROVIDER=vault is production-only (Vault runs only in compose.prod.yml); use host, sops or command for ${DEPLOY_ENV}" >&2; exit 2
fi
[[ "$IMAGE_TAG" =~ ^[0-9a-f]{7,40}$ ]] || { echo "IMAGE_TAG must be a git SHA, got: $IMAGE_TAG" >&2; exit 2; }

SSH_TARGET="${DEPLOY_USER}@${DEPLOY_HOST}"
ssh_run() { ssh -o BatchMode=yes -o StrictHostKeyChecking=yes "$SSH_TARGET" "$@"; }
api_image="${REGISTRY%/}/zenflow-api:${IMAGE_TAG}"
bandit_image="${REGISTRY%/}/zenflow-bandit:${IMAGE_TAG}"

echo "==> Deploying ${IMAGE_TAG} to ${DEPLOY_ENV} on ${DEPLOY_HOST} (secrets: ${SECRETS_PROVIDER})"
if [ "${DRY_RUN:-0}" = "1" ]; then
  echo "dry run: would run api=${api_image} bandit=${bandit_image}"; exit 0
fi

# 1. Secrets -> .env.<env> on the host (mode 600). Never written to the repo or logs.
env_target="${DEPLOY_PATH}/backend/.env.${DEPLOY_ENV}"
push_env() { ssh_run "umask 077 && mkdir -p '${DEPLOY_PATH}/backend' && cat > '${env_target}.new' && mv '${env_target}.new' '${env_target}'"; }
case "$SECRETS_PROVIDER" in
  host)    echo "==> Secrets: using ${env_target} already on the host" ;;
  sops)    sops --decrypt --input-type dotenv --output-type dotenv \
             "${SOPS_FILE:-backend/secrets/${DEPLOY_ENV}.env.enc}" | push_env ;;
  command) bash -c "${SECRETS_COMMAND:?SECRETS_COMMAND required}" | push_env ;;
  vault)   # Secrets stay on the host: they are rendered from the Vault container into
           # tmpfs *_FILE mounts during the remote steps. .env.<env> then holds only
           # non-secret config; compose still needs the file to exist.
           ssh_run "umask 077 && mkdir -p '${DEPLOY_PATH}/backend' && touch '${env_target}'"
           echo "==> Secrets: rendering from Vault on the host (see remote steps)" ;;
  *)       echo "unknown SECRETS_PROVIDER ${SECRETS_PROVIDER}" >&2; exit 2 ;;
esac

# 2. Ship compose + proxy/observability config from this exact commit, so a
#    rollback also restores the config that matched that release.
rsync -az -e "ssh -o BatchMode=yes -o StrictHostKeyChecking=yes" \
  "backend/compose.${DEPLOY_ENV}.yml" backend/docker-entrypoint.sh \
  "${SSH_TARGET}:${DEPLOY_PATH}/backend/"
[ -d backend/nginx ] && rsync -az -e "ssh -o BatchMode=yes -o StrictHostKeyChecking=yes" \
  backend/nginx "${SSH_TARGET}:${DEPLOY_PATH}/backend/"
[ -d backend/ops/vault ] && rsync -az -e "ssh -o BatchMode=yes -o StrictHostKeyChecking=yes" \
  backend/ops "${SSH_TARGET}:${DEPLOY_PATH}/backend/"
[ -d backend/observability ] && rsync -az -e "ssh -o BatchMode=yes -o StrictHostKeyChecking=yes" \
  backend/observability "${SSH_TARGET}:${DEPLOY_PATH}/backend/"

# 3. REMOTE STEPS (replace for a non-compose target).
if [ -n "${REGISTRY_USER:-}" ] && [ -n "${REGISTRY_TOKEN:-}" ]; then
  printf '%s' "$REGISTRY_TOKEN" | ssh_run "docker login '${REGISTRY%%/*}' -u '${REGISTRY_USER}' --password-stdin"
fi
# ssh joins its arguments into one string for the remote shell, so quote each
# one (%q) to keep values with spaces as single positional parameters.
remote_args=$(printf ' %q' \
  "$DEPLOY_ENV" "$IMAGE_TAG" "$api_image" "$bandit_image" "$DEPLOY_PATH" \
  "$SECRETS_PROVIDER" "${VAULT_ADDR:-http://127.0.0.1:8200}" \
  "${VAULT_ROLE_ID_FILE:-/etc/zenflow/vault/role_id}" "${VAULT_SECRET_ID_FILE:-/etc/zenflow/vault/secret_id}")
ssh_run "bash -s${remote_args}" <<'REMOTE'
set -euo pipefail
env_name="$1"; tag="$2"; api="$3"; bandit="$4"; path="$5"
provider="$6"; vault_addr="$7"; role_id_file="$8"; secret_id_file="$9"
cd "$path/backend"
export ZENFLOW_API_IMAGE="$api" ZENFLOW_BANDIT_IMAGE="$bandit"
prev="$(tail -n1 "$path/.deploy-history" 2>/dev/null | awk '{print $2}' || true)"
compose="docker compose -f compose.${env_name}.yml"
$compose pull api migrations bandit
force=""
if [ "$provider" = "vault" ]; then
  # AppRole creds are root-only and /run/zenflow is a root-owned 700 dir that
  # compose reads env_file from, so the vault flow needs a root deploy account.
  if [ "$(id -u)" != 0 ]; then
    echo "SECRETS_PROVIDER=vault requires DEPLOY_USER=root on the host (see docs/ops/secrets.md)" >&2; exit 1
  fi
  export ZENFLOW_SECRETS_DIR="/run/zenflow/${env_name}"
  $compose up -d --no-build vault
  # Vault starts sealed after any restart; unsealing is a manual, human step.
  for i in $(seq 1 20); do
    code="$(curl -s -o /dev/null -w '%{http_code}' "${vault_addr}/v1/sys/health" || true)"
    [ "$code" = "200" ] && break
    [ "$i" = 20 ] && { echo "Vault not ready (health HTTP ${code}; 503=sealed, 501=uninitialised). Unseal it: docs/ops/secrets.md" >&2; exit 1; }
    sleep 3
  done
  VAULT_ADDR="$vault_addr" VAULT_ENV="$env_name" OUT_DIR="$ZENFLOW_SECRETS_DIR" \
    VAULT_ROLE_ID_FILE="$role_id_file" VAULT_SECRET_ID_FILE="$secret_id_file" \
    ./ops/vault/render-secrets.sh
  # An explicit KEY in .env.<env> would beat the rendered KEY_FILE, so drop any
  # leftovers from a previous dotenv-based provider.
  for f in "$ZENFLOW_SECRETS_DIR"/*/files.env; do
    [ -f "$f" ] || continue
    sed -n 's/_FILE=.*//p' "$f" | while read -r k; do sed -i "/^${k}=/d" ".env.${env_name}"; done
  done
  # Containers read *_FILE only at boot, so always restart them after a render.
  force="--force-recreate"
  svcs="api migrations bandit"
fi
# `migrations` (prisma migrate deploy) runs to completion before `api` starts.
if [ -n "$force" ]; then
  # Recreate only the consumers; leave postgres/redis/vault running.
  $compose up -d --no-build --remove-orphans
  $compose up -d --no-build --force-recreate $svcs
else
  $compose up -d --no-build --remove-orphans
fi
echo "$(date -u +%FT%TZ) $tag prev=${prev:-none}" >> "$path/.deploy-history"
$compose ps
REMOTE

# 4. Health gate from the runner (optional).
if [ -n "${HEALTHCHECK_URL:-}" ]; then
  for i in $(seq 1 30); do
    curl -fsS --max-time 5 "$HEALTHCHECK_URL" >/dev/null && { echo "==> healthy"; exit 0; }
    sleep 5
  done
  echo "health check failed: ${HEALTHCHECK_URL}. Roll back: re-run Deploy with the previous SHA (docs/ops/ci-cd.md)." >&2
  exit 1
fi
