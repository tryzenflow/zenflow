#!/usr/bin/env bash
# sim-arms.sh — committed driver that runs the multi-arm sim comparison in
# PARALLEL against separate per-arm databases, then evaluates each arm and runs
# paired significance over the arm pairs.
#
# Replaces the throwaway run-mar-arms.sh / _reconfirm-50.sh shells. Where those
# ran arms SERIALLY against ONE shared DB (truncate → run → eval, one at a time,
# so wall-clock ≈ Σ arms), this gives each arm its OWN logical database in the
# SAME postgres container (see sim-db.sh) and runs the expensive `sim:run`
# (population gen + closed loop + bulk write) for all arms CONCURRENTLY. Wall-clock
# drops toward max(arm) + eval, bounded by CPU cores / DB throughput.
#
# Determinism is preserved: every arm uses the SAME --seed / --start / --days /
# population; arms differ ONLY in their re-ranker knobs. Each arm writes to its own
# DB (distinct DATABASE_URL) and its own sidecar dir (SIM_OUTPUT_DIR), so parallel
# arms never collide on rows or ground-truth files.
#
# Usage:
#   bash scripts/sim-arms.sh [flags]
#   # or via package.json:  pnpm --filter backend sim:arms -- [flags]
#
# Flags (all optional; defaults reproduce the 3-arm MAR comparison):
#   --seed=<int>                  population seed (default 42)
#   --start=YYYY-MM-DD            timeline start (default 2025-01-06, a Monday)
#   --days=<int>                  span days (default 90)
#   --personas-per-cohort=<int>   keep first N personas of EACH cohort (smoke: 1)
#   --personas=<int>              flat cap (smoke runs)
#   --mode=batched|service        persistence (default batched)
#   --out=<dir>                   output root (default sim-output/arms)
#   --jobs=<int>                  max arms to run concurrently (default = #arms)
#   --no-build                    skip the nest build (reuse dist/)
#   --keep-dbs                    don't drop the arm DBs at the end
#   --arm="name:flags"            define an arm (repeatable). "flags" are passed to
#                                 run.js verbatim. Defining ANY --arm replaces the
#                                 default arm set.
#
# Default arms (override with --arm=...):
#   identity : --reranker=identity
#   greedy   : --reranker=phase2 --temperature=1e-6
#   softmax  : --reranker=phase2 --temperature=1.0
#
# Significance is run for every arm paired AGAINST THE FIRST arm (the baseline),
# matched per-persona by the stable personaKey the eval already emits.
#
# Windows: run under Git Bash (the repo's bash tool). Docker Desktop must be up so
# `docker exec zenflow-db ...` works; the dev stack provides the container
# (compose.dev.yml). PowerShell users: `bash backend/scripts/sim-arms.sh ...`.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$(cd "$HERE/.." && pwd)"
cd "$BACKEND_DIR"

SIM_DB="$HERE/sim-db.sh"

# ── defaults ────────────────────────────────────────────────────────────────
SEED=42
START=2025-01-06
DAYS=90
PERCOHORT=""
PERSONAS=""
MODE=batched
OUT=sim-output/arms
JOBS=""
DO_BUILD=1
KEEP_DBS=0
declare -a ARM_DEFS=()

for arg in "$@"; do
  case "$arg" in
    --seed=*)                 SEED="${arg#*=}" ;;
    --start=*)                START="${arg#*=}" ;;
    --days=*)                 DAYS="${arg#*=}" ;;
    --personas-per-cohort=*)  PERCOHORT="${arg#*=}" ;;
    --personas=*)             PERSONAS="${arg#*=}" ;;
    --mode=*)                 MODE="${arg#*=}" ;;
    --out=*)                  OUT="${arg#*=}" ;;
    --jobs=*)                 JOBS="${arg#*=}" ;;
    --no-build)               DO_BUILD=0 ;;
    --keep-dbs)               KEEP_DBS=1 ;;
    --arm=*)                  ARM_DEFS+=("${arg#*=}") ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

if [ "${#ARM_DEFS[@]}" -eq 0 ]; then
  ARM_DEFS=(
    "identity:--reranker=identity"
    "greedy:--reranker=phase2 --temperature=1e-6"
    "softmax:--reranker=phase2 --temperature=1.0"
  )
fi

# Shared args every arm gets (the population-defining ones — identical across arms
# so the comparison is paired/deterministic).
COMMON=(--seed="$SEED" --start="$START" --days="$DAYS" --mode="$MODE")
[ -n "$PERCOHORT" ] && COMMON+=(--personas-per-cohort="$PERCOHORT")
[ -n "$PERSONAS" ]  && COMMON+=(--personas="$PERSONAS")

mkdir -p "$OUT"
ARM_NAMES=()
for def in "${ARM_DEFS[@]}"; do ARM_NAMES+=("${def%%:*}"); done
echo "[arms] arms: ${ARM_NAMES[*]}  seed=$SEED days=$DAYS start=$START mode=$MODE out=$OUT"

# ── build once ───────────────────────────────────────────────────────────────
if [ "$DO_BUILD" -eq 1 ]; then
  echo "[arms] building (nest build)…"
  pnpm sim:build
fi

# ── provision per-arm databases (clone of the migrated template) ─────────────
echo "[arms] provisioning ${#ARM_NAMES[@]} arm database(s)…"
bash "$SIM_DB" create "${ARM_NAMES[@]}"
echo "[arms] fast-resetting arm databases…"
bash "$SIM_DB" reset "${ARM_NAMES[@]}"

# ── run all arms in parallel, each against its own DB + sidecar dir ──────────
declare -a PIDS=()
declare -a RUNNING_ARMS=()
MAX_JOBS=${JOBS:-${#ARM_NAMES[@]}}

wait_one() {
  # Block until at least one running arm finishes; fail fast on a nonzero exit.
  local i pid arm
  for i in "${!PIDS[@]}"; do
    pid="${PIDS[$i]}"; arm="${RUNNING_ARMS[$i]}"
    if ! kill -0 "$pid" 2>/dev/null; then
      if ! wait "$pid"; then
        echo "[arms] FATAL: arm '$arm' (sim:run) failed — see $OUT/$arm.run.stderr" >&2
        exit 1
      fi
      unset 'PIDS[i]'; unset 'RUNNING_ARMS[i]'
      PIDS=("${PIDS[@]}"); RUNNING_ARMS=("${RUNNING_ARMS[@]}")
      return 0
    fi
  done
  # None finished yet — wait on the first and re-scan.
  wait "${PIDS[0]}" || {
    echo "[arms] FATAL: arm '${RUNNING_ARMS[0]}' (sim:run) failed" >&2; exit 1;
  }
  unset 'PIDS[0]'; unset 'RUNNING_ARMS[0]'
  PIDS=("${PIDS[@]}"); RUNNING_ARMS=("${RUNNING_ARMS[@]}")
}

run_arm() {
  local arm="$1" flags="$2"
  local url armdir
  url=$(bash "$SIM_DB" url "$arm")
  armdir="$OUT/$arm"
  mkdir -p "$armdir"
  echo "[arms] [$(date +%T)] start arm '$arm'  flags: $flags"
  # Each arm targets its OWN DATABASE_URL (isolated DB) + SIM_OUTPUT_DIR (isolated
  # ground-truth sidecar). `.env.sim` provides the rest of the sim config
  # (redis/mail/etc.) unchanged — but dotenv-cli would otherwise set the SINGLE-DB
  # DATABASE_URL from that file, so we re-inject the per-arm DATABASE_URL +
  # SIM_OUTPUT_DIR through `env` AFTER dotenv loads, giving them precedence.
  # shellcheck disable=SC2086
  pnpm exec dotenv -e .env.sim -- \
    env DATABASE_URL="$url" SIM_OUTPUT_DIR="$armdir" \
    node dist/simulation/run.js "${COMMON[@]}" $flags \
    1> "$armdir/run.stdout" 2> "$armdir/run.stderr" &
  PIDS+=("$!"); RUNNING_ARMS+=("$arm")
}

for def in "${ARM_DEFS[@]}"; do
  arm="${def%%:*}"; flags="${def#*:}"
  # Throttle to MAX_JOBS concurrent arms.
  while [ "${#PIDS[@]}" -ge "$MAX_JOBS" ]; do wait_one; done
  run_arm "$arm" "$flags"
done

# Drain the rest.
while [ "${#PIDS[@]}" -gt 0 ]; do wait_one; done
echo "[arms] [$(date +%T)] all sim:run arms complete"

# ── eval each arm (serial; cheap vs sim:run) against its own DB ──────────────
for def in "${ARM_DEFS[@]}"; do
  arm="${def%%:*}"
  url=$(bash "$SIM_DB" url "$arm")
  armdir="$OUT/$arm"
  echo "[arms] [$(date +%T)] sim:eval arm '$arm' → $armdir/eval.json"
  pnpm exec dotenv -e .env.sim -- \
    env DATABASE_URL="$url" SIM_OUTPUT_DIR="$armdir" \
    node dist/simulation/eval/run-metrics.js \
    1> "$armdir/eval.json" 2> "$armdir/eval.stderr"
  # Fail loudly if the dump isn't valid JSON (matches _reconfirm-50.sh's guard).
  node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))" "$armdir/eval.json" \
    || { echo "[arms] FATAL: $armdir/eval.json is not valid JSON" >&2; exit 1; }
  echo "[arms]   $(cat "$armdir/eval.stderr" | head -n1)"
done

# ── paired significance: every arm vs the FIRST (baseline) arm ───────────────
BASE="${ARM_NAMES[0]}"
PAIRS=""
for arm in "${ARM_NAMES[@]:1}"; do
  PAIRS="${PAIRS:+$PAIRS,}$OUT/$BASE/eval.json=$OUT/$arm/eval.json"
done
if [ -n "$PAIRS" ]; then
  echo "[arms] [$(date +%T)] sim:significance ($BASE vs others)"
  # significance.js logs a human summary via the Nest Logger AND prints the JSON
  # sweep via console.log; capture the combined stream (matches the prior driver's
  # `tee … .txt`). Console shows the one-line per-pair summary too.
  node dist/simulation/eval/significance.js --pairs="$PAIRS" | tee "$OUT/significance.txt"
  echo "[arms] significance summary → $OUT/significance.txt"
fi

# ── cleanup ──────────────────────────────────────────────────────────────────
if [ "$KEEP_DBS" -eq 0 ]; then
  echo "[arms] dropping arm databases (pass --keep-dbs to retain)…"
  bash "$SIM_DB" drop "${ARM_NAMES[@]}"
fi
echo "[arms] [$(date +%T)] DONE. Artifacts under $OUT/"
