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
#                     (default /etc/zenflow/vault/{role_id,secret_id}, owned by the deploy user, 600)
#   VAULT_ADDR        for vault: address as seen from the host (default http://127.0.0.1:8200)
#   SOPS_FILE         for sops: path to the encrypted dotenv (default backend/secrets/<env>.env.enc)
#   SECRETS_COMMAND   for command: prints a dotenv document on stdout
#   REGISTRY_USER / REGISTRY_TOKEN  to `docker login` on the host (omit if public/pre-logged-in)
#   HEALTHCHECK_URL   polled from the runner after the rollout
#   DEPLOY_MODE       deploy (default) | flip. flip = roll back to the previous colour while it
#                     is still up (IMAGE_TAG and REGISTRY not needed)
#   OLD_COLOUR_TTL    seconds the previous colour keeps running after a flip (default 600)
#   MIN_FREE_MB       abort before the flip if the host would have less available memory than
#                     this once the new colour is scaled up (default 512)
#   DRY_RUN=1         print the plan, touch nothing
#
# Blue-green (ADR-0013): the app tier (api xN + bandit) runs as two colours; the idle one is
# started, health-gated, then nginx is pointed at it. Host state lives in
# $DEPLOY_PATH/backend/state/ (active, upstream.api.conf, images.env, reaper.pid).
set -euo pipefail

DEPLOY_MODE="${DEPLOY_MODE:-deploy}"
case "$DEPLOY_MODE" in deploy|flip) ;; *) echo "DEPLOY_MODE must be deploy or flip" >&2; exit 2;; esac
: "${DEPLOY_ENV:?}" "${DEPLOY_HOST:?}" "${DEPLOY_USER:?}" "${DEPLOY_PATH:?}"
if [ "$DEPLOY_MODE" = "deploy" ]; then : "${IMAGE_TAG:?}" "${REGISTRY:?}"; fi
IMAGE_TAG="${IMAGE_TAG:-}"; REGISTRY="${REGISTRY:-}"
OLD_COLOUR_TTL="${OLD_COLOUR_TTL:-600}"; MIN_FREE_MB="${MIN_FREE_MB:-512}"
[[ "$OLD_COLOUR_TTL" =~ ^[0-9]+$ && "$MIN_FREE_MB" =~ ^[0-9]+$ ]] || { echo "OLD_COLOUR_TTL and MIN_FREE_MB must be integers" >&2; exit 2; }
SECRETS_PROVIDER="${SECRETS_PROVIDER:-host}"
case "$DEPLOY_ENV" in staging|prod) ;; *) echo "DEPLOY_ENV must be staging or prod" >&2; exit 2;; esac
if [ "$SECRETS_PROVIDER" = "vault" ] && [ "$DEPLOY_ENV" != "prod" ]; then
  echo "SECRETS_PROVIDER=vault is production-only (Vault runs only in compose.prod.yml); use host, sops or command for ${DEPLOY_ENV}" >&2; exit 2
fi
if [ "$DEPLOY_MODE" = "deploy" ]; then
  [[ "$IMAGE_TAG" =~ ^[0-9a-f]{7,40}$ ]] || { echo "IMAGE_TAG must be a git SHA, got: $IMAGE_TAG" >&2; exit 2; }
fi

SSH_TARGET="${DEPLOY_USER}@${DEPLOY_HOST}"
ssh_run() { ssh -o BatchMode=yes -o StrictHostKeyChecking=yes "$SSH_TARGET" "$@"; }
api_image="${REGISTRY%/}/zenflow-api:${IMAGE_TAG}"
bandit_image="${REGISTRY%/}/zenflow-bandit:${IMAGE_TAG}"

if [ "$DEPLOY_MODE" = "flip" ]; then
  echo "==> Flipping ${DEPLOY_ENV} on ${DEPLOY_HOST} back to the previous colour"
else
  echo "==> Deploying ${IMAGE_TAG} to ${DEPLOY_ENV} on ${DEPLOY_HOST} (secrets: ${SECRETS_PROVIDER})"
fi
if [ "${DRY_RUN:-0}" = "1" ]; then
  echo "dry run: mode=${DEPLOY_MODE} api=${api_image} bandit=${bandit_image} ttl=${OLD_COLOUR_TTL}s min_free=${MIN_FREE_MB}MB"; exit 0
fi

if [ "$DEPLOY_MODE" = "deploy" ]; then
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
fi

# 3. REMOTE STEPS (replace for a non-compose target).
if [ "$DEPLOY_MODE" = "deploy" ] && [ -n "${REGISTRY_USER:-}" ] && [ -n "${REGISTRY_TOKEN:-}" ]; then
  printf '%s' "$REGISTRY_TOKEN" | ssh_run "docker login '${REGISTRY%%/*}' -u '${REGISTRY_USER}' --password-stdin"
fi
# ssh joins its arguments into one string for the remote shell, so quote each
# one (%q) to keep values with spaces as single positional parameters.
remote_args=$(printf ' %q' \
  "$DEPLOY_ENV" "$IMAGE_TAG" "$api_image" "$bandit_image" "$DEPLOY_PATH" \
  "$SECRETS_PROVIDER" "${VAULT_ADDR:-http://127.0.0.1:8200}" \
  "${VAULT_ROLE_ID_FILE:-/etc/zenflow/vault/role_id}" "${VAULT_SECRET_ID_FILE:-/etc/zenflow/vault/secret_id}" \
  "$DEPLOY_MODE" "$OLD_COLOUR_TTL" "$MIN_FREE_MB")
ssh_run "bash -s${remote_args}" <<'REMOTE'
set -euo pipefail
env_name="$1"; tag="$2"; api="$3"; bandit="$4"; path="$5"
provider="$6"; vault_addr="$7"; role_id_file="$8"; secret_id_file="$9"
mode="${10}"; ttl="${11}"; min_free_mb="${12}"
cd "$path/backend"
# --env-file: ${VAR} interpolation (Grafana password/SMTP, backup schedules) reads .env.<env>, not just env_file.
compose="docker compose --env-file .env.${env_name} -f compose.${env_name}.yml"
workers="watcher worker-portal worker-lms worker-notify"
mkdir -p state
active="$(cat state/active 2>/dev/null || true)"
other() { [ "$1" = blue ] && echo green || echo blue; }

# Images per colour survive between deploys, so touching one colour never recreates the other.
set -a; [ -f state/images.env ] && . state/images.env; set +a
save_images() {
  env | grep -E '^ZENFLOW_(API|BANDIT)_IMAGE_(BLUE|GREEN)=' | sort > state/images.env.new
  mv state/images.env.new state/images.env
}
reload_nginx() { $compose exec -T nginx sh -c 'nginx -t && nginx -s reload'; }
point_nginx_at() {
  printf 'server api-%s:8000;\n' "$1" > state/upstream.api.conf.new
  mv state/upstream.api.conf.new state/upstream.api.conf
  $compose up -d --no-build --no-deps nginx   # first deploy: starts it; later: no-op
  reload_nginx
  echo "$1" > state/active
}
cancel_reaper() {
  if [ -f state/reaper.pid ]; then kill "$(cat state/reaper.pid)" 2>/dev/null || true; rm -f state/reaper.pid; fi
}
# Keep the old colour up for `ttl` seconds (instant flip back), then stop it.
schedule_reaper() {
  local old="$1"
  [ -n "$old" ] || return 0
  if [ "$ttl" = 0 ]; then $compose stop "api-$old" "bandit-$old"; return 0; fi
  nohup setsid bash -c "sleep $ttl; cd '$PWD' && $compose stop api-$old bandit-$old; rm -f state/reaper.pid" \
    </dev/null >/dev/null 2>&1 &
  echo $! > state/reaper.pid
  echo "==> ${old} stays up for ${ttl}s (flip back: DEPLOY_MODE=flip), then stops"
}
restart_workers() {
  ZENFLOW_ACTIVE_COLOUR="$1" ZENFLOW_API_IMAGE="$2" \
    $compose up -d --no-build --no-deps --force-recreate $workers
}

if [ "$mode" = flip ]; then
  [ -n "$active" ] || { echo "no active colour recorded on the host; run a normal deploy" >&2; exit 1; }
  prev="$(other "$active")"
  for svc in "api-$prev" "bandit-$prev"; do
    ids="$($compose ps -q --status running "$svc")"
    [ -n "$ids" ] || { echo "$prev colour is not running (past OLD_COLOUR_TTL?). Roll back with the Deploy workflow and the previous SHA (docs/ops/ci-cd.md)." >&2; exit 1; }
  done
  for id in $($compose ps -q "api-$prev"); do
    [ "$(docker inspect -f '{{.State.Health.Status}}' "$id")" = healthy ] || { echo "$prev api is not healthy; not flipping" >&2; exit 1; }
  done
  cancel_reaper
  point_nginx_at "$prev"
  prev_api_var="ZENFLOW_API_IMAGE_$(echo "$prev" | tr a-z A-Z)"
  restart_workers "$prev" "${!prev_api_var}"
  schedule_reaper "$active"
  echo "$(date -u +%FT%TZ) flip $active->$prev" >> "$path/.deploy-history"
  $compose ps
  exit 0
fi

# ---- deploy ----
idle="$(other "${active:-green}")"            # first deploy: blue
IDLE="$(echo "$idle" | tr a-z A-Z)"
prev="$(tail -n1 "$path/.deploy-history" 2>/dev/null | awk '{print $2}' || true)"
cancel_reaper
export ZENFLOW_API_IMAGE="$api" ZENFLOW_BANDIT_IMAGE="$bandit"
export "ZENFLOW_API_IMAGE_${IDLE}=$api" "ZENFLOW_BANDIT_IMAGE_${IDLE}=$bandit"
export ZENFLOW_ACTIVE_COLOUR="$idle"
$compose pull "api-$idle" "bandit-$idle" $workers migrations
if [ "$provider" = "vault" ]; then
  # The deploy account must own the AppRole creds and /run/zenflow (700, tmpfs) that
  # compose reads env_file from; root is not required (see docs/ops/ci-cd.md).
  for f in "$role_id_file" "$secret_id_file"; do
    [ -r "$f" ] || { echo "SECRETS_PROVIDER=vault: $f is not readable by $(id -un); the deploy user must own the AppRole creds" >&2; exit 1; }
  done
  [ -d /run/zenflow ] && [ -w /run/zenflow ] || [ "$(id -u)" = 0 ] || {
    echo "SECRETS_PROVIDER=vault: /run/zenflow must exist and be writable by $(id -un) (e.g. sudo install -d -o $(id -un) -m 700 /run/zenflow)" >&2; exit 1; }
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
fi
# Containers read *_FILE only at boot; the idle colour and the queue roles are always
# recreated below, so they pick up a fresh render. The active colour keeps its loaded secrets.

# Shared tier: everything except the colours, the queue roles, nginx and the one-shot migrations.
shared="$($compose config --services | grep -Ev '^(api|bandit)-(blue|green)$|^(watcher|worker-.*)$|^(nginx|migrations)$' | tr '\n' ' ')"
$compose up -d --no-build --remove-orphans $shared
# Migrations run once for both colours, so they must be backward compatible (ADR-0013).
$compose run --rm migrations

# Start the idle colour at one replica and gate it before it gets traffic.
stop_idle() { $compose stop "api-$idle" "bandit-$idle" || true; }
$compose up -d --no-build --no-deps --force-recreate --scale "api-$idle=1" "bandit-$idle" "api-$idle"
healthy=""
for i in $(seq 1 40); do
  id="$($compose ps -q "api-$idle" | head -n1)"
  st="$([ -n "$id" ] && docker inspect -f '{{.State.Health.Status}}' "$id" || echo none)"
  [ "$st" = healthy ] && { healthy=1; break; }
  sleep 3
done
[ -n "$healthy" ] || { echo "api-$idle never became healthy (/api/v1/health/ready)" >&2; $compose logs --tail 50 "api-$idle" >&2 || true; stop_idle; exit 1; }
# Smoke: full dependency report (adds the queue/ratelimit Redis and bandit-$idle).
if ! $compose exec -T "api-$idle" node -e "fetch('http://127.0.0.1:8000/api/v1/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"; then
  echo "smoke request /api/v1/health failed on api-$idle" >&2; $compose logs --tail 50 "api-$idle" "bandit-$idle" >&2 || true; stop_idle; exit 1
fi

# Memory guard: the remaining replicas are still to come up while the old colour runs.
replicas="$($compose config | awk -v s="  api-$idle:" '$0==s{f=1;next} f&&/^  [a-z]/{exit} f&&/replicas:/{print $2; exit}')"
replicas="${replicas:-2}"
avail_mb="$(awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo)"
need_mb=$(( (replicas - 1) * 800 + min_free_mb ))
echo "==> overlap memory: ${avail_mb} MB available, need ${need_mb} MB for ${replicas} replicas"
docker stats --no-stream --format 'table {{.Name}}\t{{.MemUsage}}\t{{.CPUPerc}}' | head -n 30 || true
if [ "$avail_mb" -lt "$need_mb" ]; then
  echo "not enough memory to scale ${idle} to ${replicas} replicas alongside ${active:-nothing} (MIN_FREE_MB=${min_free_mb}); stopping ${idle}" >&2
  stop_idle; exit 1
fi

# Flip, then bring the new colour to full size and re-read DNS for all replicas.
point_nginx_at "$idle"
$compose up -d --no-build --no-deps --no-recreate "api-$idle"
reload_nginx
save_images
restart_workers "$idle" "$api"
schedule_reaper "$active"
echo "$(date -u +%FT%TZ) $tag prev=${prev:-none} colour=$idle" >> "$path/.deploy-history"
$compose ps
REMOTE

# 4. Health gate from the runner (optional).
if [ -n "${HEALTHCHECK_URL:-}" ]; then
  for _ in $(seq 1 30); do
    curl -fsS --max-time 5 "$HEALTHCHECK_URL" >/dev/null && { echo "==> healthy"; exit 0; }
    sleep 5
  done
  echo "health check failed: ${HEALTHCHECK_URL}. Roll back: re-run Deploy with the previous SHA (docs/ops/ci-cd.md)." >&2
  exit 1
fi
