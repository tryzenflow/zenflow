#!/usr/bin/env bash
# Benchmark: baseline (occurrence cache + fan-out off, "A") vs cache + fan-out
# ("B"). The ticker fires every minute, as in production, and each run is 5
# ticks. Every sync period is 2 minutes, so each tick claims a batch of 75 of the
# 150 students and two ticks make one rolling window in which every student is
# synced once.
#   ticks 1-2  new: first ingestion, every session is new
#   after 2    some students move / delete lectures in Zenflow, then upstream:
#              8 sections change room, 8 others are removed
#   ticks 3-4  the batches pick up the changes
#   tick 5     spare, for batches whose due time slipped a tick
# Each case is repeated REPEATS times, interleaved.
#
# DESTRUCTIVE to the DEV database: `zenflow` is dropped and recreated for every
# run, Redis is flushed. Dev docker stack (backend/compose.dev.yml) must already
# be up. Everything points at the local fake DLU server; never run this against
# real hosts.
#
# Usage: backend/scripts/fixtures/dlu/bench.sh [TICKS=5] [LATENCY_MS=4]
# Env:   REPEATS=3 JITTER_MS=4 SETTLE_SEC=70 OUT=/tmp/dlu-bench
# Output: $OUT with per-run JSON, logs, session dumps; comparison on stdout.
set -euo pipefail

TICKS="${1:-5}"
LATENCY_MS="${2:-4}"
JITTER_MS="${JITTER_MS:-4}"
REPEATS="${REPEATS:-3}"
# Long enough for one more tick to fire after the measured ones.
SETTLE_SEC="${SETTLE_SEC:-70}"
OUT="${OUT:-/tmp/dlu-bench}"
HERE="$(cd "$(dirname "$0")" && pwd)"
BACKEND="$(cd "$HERE/../../.." && pwd)"
API="http://localhost:8000/api/v1"
FAKE="http://localhost:4100"
DAY_MS=86400000
# One rolling window = 2 one-minute ticks, 75 students per tick.
DATA_PERIOD_MS=120000
# Production default is 7 days. Here it is shorter than the 2-minute period, so a
# read made in one window has expired by the next and that window's first student
# per section refetches live, while the rest of the window still reuses it.
CACHE_TTL_MS=90000
rm -rf "$OUT"
mkdir -p "$OUT"
cd "$BACKEND"

PIDS=()
stop_procs() {
  for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null || true; done
  PIDS=()
  sleep 3
}
cleanup() {
  stop_procs
  [ -f "$OUT/portal-timetable.orig.json" ] && cp "$OUT/portal-timetable.orig.json" "$HERE/portal-timetable.json"
  psql_admin -c 'DROP DATABASE IF EXISTS zenflow_seed0 WITH (FORCE)' >/dev/null 2>&1 || true
  psql_admin -c 'DROP DATABASE IF EXISTS zenflow_seed WITH (FORCE)' >/dev/null 2>&1 || true
}
trap cleanup EXIT
cp "$HERE/portal-timetable.json" "$OUT/portal-timetable.orig.json"

psql_admin() { docker exec -i zenflow-db psql -v ON_ERROR_STOP=1 -U admin -d postgres -At "$@"; }
psql_() { docker exec -i -e PGOPTIONS="-c client_min_messages=warning" zenflow-db psql -v ON_ERROR_STOP=1 -U admin -d zenflow -At "$@"; }
flush_redis() {
  docker exec zenflow-cache redis-cli FLUSHALL >/dev/null
  docker exec zenflow-cache-ratelimit redis-cli FLUSHALL >/dev/null
}
restore_db() { # restore_db <template>
  psql_admin -c 'DROP DATABASE IF EXISTS zenflow WITH (FORCE)' >/dev/null
  psql_admin -c "CREATE DATABASE zenflow TEMPLATE $1" >/dev/null
}
start_fake() { # start_fake <latency> <jitter>
  cp "$OUT/portal-timetable.orig.json" "$HERE/portal-timetable.json"
  FAKE_DLU_LATENCY_MS="$1" FAKE_DLU_JITTER_MS="$2" npx ts-node scripts/fake-dlu-server.ts >>"$OUT/fake.log" 2>&1 &
  PIDS+=($!)
}
start_backend() { # start_backend <log> VAR=value...   (overrides first: dotenv never overwrites)
  local log="$1"; shift
  env INGESTION_REQUEST_DELAY_MS=0 INGESTION_TICK_MAX_BATCH=1000 \
    LMS_URL="$FAKE" PORTAL_API_URL="$FAKE" DKHP_API_URL="$FAKE" \
    PORT=8000 OTP_REQUEST_IP_LIMIT=100000 OTP_REQUEST_EMAIL_LIMIT=100000 OTP_VERIFY_IP_LIMIT=100000 OTP_VERIFY_EMAIL_LIMIT=100000 PORTAL_API_KEY=bench DKHP_API_KEY=bench "$@" \
    npx dotenv -e .env.dev -- env NODE_EXTRA_CA_CERTS=certs/lms-ca.pem node dist/main >"$log" 2>&1 &
  PIDS+=($!)
}
wait_up() {
  for _ in $(seq 60); do curl -s -o /dev/null "$FAKE/_/stats" && curl -s -o /dev/null "$API/../" && return 0; sleep 2; done
  echo "stack did not come up" >&2; return 1
}
# wait_for_count <regex on byKey> <min> <timeout s>: poll the fake's counters.
wait_for_count() {
  for _ in $(seq "$3"); do
    n=$(curl -s "$FAKE/_/stats" | node -e '
      const re = new RegExp(process.argv[1]); let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
        const by = JSON.parse(s || "{}").byKey ?? {}; console.log(Object.entries(by).filter(([k]) => re.test(k)).reduce((a, [, v]) => a + v, 0)); })' "$1")
    [ "${n:-0}" -ge "$2" ] && return 0
    sleep 1
  done
  echo "timed out waiting for $1 >= $2 (got ${n:-0})" >&2; return 1
}
NUM_STUDENTS=$(node -e 'console.log(require(process.argv[1]).length)' "$HERE/students.json")

# ---------------------------------------------------------------- one-time setup
echo "=== setup: seed $NUM_STUDENTS students with ingestion off ==="
psql_admin -c 'DROP DATABASE IF EXISTS zenflow WITH (FORCE)' >/dev/null
psql_admin -c 'DROP DATABASE IF EXISTS zenflow_seed0 WITH (FORCE)' >/dev/null
psql_admin -c 'DROP DATABASE IF EXISTS zenflow_seed WITH (FORCE)' >/dev/null
psql_admin -c 'CREATE DATABASE zenflow' >/dev/null
flush_redis
curl -s -X DELETE http://localhost:8025/api/v1/messages >/dev/null || true
echo "migrating"
npx dotenv -e .env.dev -- node scripts/with-database-url.cjs npx prisma migrate deploy >"$OUT/setup.migrate.log" 2>&1
start_fake 0 0
start_backend "$OUT/setup.seed.backend.log" INGESTION_ENABLED=false
wait_up; sleep 5
ZENFLOW_API="$API" node "$HERE/seed-and-sync.js" >"$OUT/setup.seed.log" 2>&1
tail -n 4 "$OUT/setup.seed.log" | head -n 2
stop_procs
psql_admin -c 'CREATE DATABASE zenflow_seed0 TEMPLATE zenflow' >/dev/null

echo "=== setup: gate check (all kinds due at once, no discovery done yet) ==="
restore_db zenflow_seed0; flush_redis
start_fake 0 0
start_backend "$OUT/setup.gate.backend.log" INGESTION_OCCURRENCE_CACHE_ENABLED=true \
  INGESTION_PORTAL_DISCOVERY_PERIOD_MS=60000 INGESTION_LMS_DISCOVERY_PERIOD_MS=60000 \
  INGESTION_TIMETABLE_PERIOD_MS=60000 INGESTION_EXAM_PERIOD_MS=60000 INGESTION_LMS_CALENDAR_PERIOD_MS=60000
wait_up
wait_for_count '^dkhp:history:' "$NUM_STUDENTS" 150
sleep 20
curl -s "$FAKE/_/log" >"$OUT/setup.gate.log.json"
stop_procs

echo "=== setup: discovery warm-up (one-time cost, data kinds held back) ==="
restore_db zenflow_seed0; flush_redis
psql_ -c "UPDATE \"IngestionSchedule\" SET \"nextDueAt\" = now() + interval '1 day' WHERE kind IN ('PORTAL_TIMETABLE','PORTAL_EXAM','LMS_CALENDAR')" >/dev/null
start_fake 0 0
start_backend "$OUT/setup.warm.backend.log" INGESTION_OCCURRENCE_CACHE_ENABLED=false \
  INGESTION_PORTAL_DISCOVERY_PERIOD_MS=60000 INGESTION_LMS_DISCOVERY_PERIOD_MS=60000 \
  INGESTION_TIMETABLE_PERIOD_MS=$DAY_MS INGESTION_EXAM_PERIOD_MS=$DAY_MS INGESTION_LMS_CALENDAR_PERIOD_MS=$DAY_MS
wait_up
wait_for_count '^dkhp:history:' "$NUM_STUDENTS" 150
wait_for_count '^lms:enrolled:' "$NUM_STUDENTS" 150
sleep 5
curl -s "$FAKE/_/stats" >"$OUT/setup.warm.stats.json"
stop_procs
psql_admin -c 'CREATE DATABASE zenflow_seed TEMPLATE zenflow' >/dev/null

# ------------------------------------------------------------------------ runs
run() { # run <label> <cache true|false>
  local label="$1" cache="$2"
  echo "=== run $label (cache=$cache) ==="
  restore_db zenflow_seed; flush_redis
  # Discovery is done (snapshot) and next due a day out, as in production; the
  # three data kinds are due now.
  psql_ -c "UPDATE \"IngestionSchedule\" SET \"nextDueAt\" = now() WHERE kind IN ('PORTAL_TIMETABLE','PORTAL_EXAM','LMS_CALENDAR');
            UPDATE \"IngestionSchedule\" SET \"nextDueAt\" = now() + interval '1 day' WHERE kind IN ('PORTAL_DISCOVERY','LMS_DISCOVERY')" >/dev/null
  start_fake "$LATENCY_MS" "$JITTER_MS"
  start_backend "$OUT/$label.backend.log" INGESTION_OCCURRENCE_CACHE_ENABLED="$cache" \
    INGESTION_PORTAL_DISCOVERY_PERIOD_MS=$DAY_MS INGESTION_LMS_DISCOVERY_PERIOD_MS=$DAY_MS \
    INGESTION_CACHE_TTL_MS=$CACHE_TTL_MS \
    INGESTION_TIMETABLE_PERIOD_MS=$DATA_PERIOD_MS INGESTION_EXAM_PERIOD_MS=$DATA_PERIOD_MS INGESTION_LMS_CALENDAR_PERIOD_MS=$DATA_PERIOD_MS
  wait_up; sleep 5

  rm -f "$OUT/$label.started"
  UPD_IDS=$(node "$HERE/mutate.js" ids update); REM_IDS=$(node "$HERE/mutate.js" ids remove)
  (
    while [ ! -f "$OUT/$label.started" ]; do sleep 0.2; done
    # Window 1 is over (its last batch starts at +62 s and takes seconds); window 2 starts at +122 s.
    sleep 100
    # Students move / delete lectures in Zenflow. Per occurrence, the first user (by id)
    # moves it an hour later, the second deletes it. Only sessions that exist now.
    psql_ -c "WITH r AS (
        SELECT s.id, (s.\"externalKey\" ~ '($UPD_IDS)') AS upd,
               row_number() OVER (PARTITION BY s.\"externalKey\" ORDER BY s.\"userId\") AS rn
        FROM \"Session\" s
        WHERE s.source = 'PORTAL' AND s.deleted = false AND s.\"externalKey\" ~ '($UPD_IDS|$REM_IDS)')
      , mv AS (UPDATE \"Session\" s SET \"lastMovedAt\" = now(), \"scheduledStartTime\" = s.\"scheduledStartTime\" + interval '1 hour'
               FROM r WHERE r.id = s.id AND r.rn = 1 RETURNING r.upd)
      , del AS (UPDATE \"Session\" s SET deleted = true FROM r WHERE r.id = s.id AND r.rn = 2 RETURNING r.upd)
      SELECT 'moved_update', count(*) FILTER (WHERE upd) FROM mv UNION ALL SELECT 'moved_remove', count(*) FILTER (WHERE NOT upd) FROM mv
      UNION ALL SELECT 'deleted_update', count(*) FILTER (WHERE upd) FROM del UNION ALL SELECT 'deleted_remove', count(*) FILTER (WHERE NOT upd) FROM del" \
      -F '|' >"$OUT/$label.custom.pre.txt"
    node "$HERE/mutate.js" update; node "$HERE/mutate.js" remove
    curl -s -X POST "$FAKE/_/reload-fixtures" >/dev/null
  ) >"$OUT/$label.mutate.log" 2>&1 &
  MUTATOR=$!
  node "$HERE/measure.js" --ticks "$TICKS" --label "$label" --json "$OUT/$label.json" \
    --started-file "$OUT/$label.started" | tee "$OUT/$label.measure.log"
  wait "$MUTATOR"

  # Let in-flight passes drain so a slow baseline is compared on converged data.
  sleep "$SETTLE_SEC"
  curl -s "$FAKE/_/log" >"$OUT/$label.log.json"
  # Normalised calendar blocks: no ids or timestamps, sorted.
  psql_ -F '|' -c "SELECT u.email, s.\"externalKey\", s.source, s.type, s.title, coalesce(s.location,''),
      s.\"scheduledStartTime\", s.\"durationMinutes\", s.deleted
    FROM \"Session\" s JOIN \"User\" u ON u.id = s.\"userId\"
    WHERE s.source IN ('LMS','PORTAL') ORDER BY 1,2,3" >"$OUT/$label.sessions.txt"
  # What became of the student's own moves and deletes, and of everyone else.
  # Removed sections are checked from now on: a walk only reconciles upcoming sessions.
  psql_ -F '|' -c "SELECT
      count(*) FILTER (WHERE upd AND moved AND NOT deleted AND location NOT LIKE 'CHG-%') AS moved_kept,
      count(*) FILTER (WHERE upd AND moved AND location LIKE 'CHG-%') AS moved_overwritten,
      count(*) FILTER (WHERE upd AND deleted) AS deleted_kept,
      count(*) FILTER (WHERE upd AND NOT moved AND NOT deleted AND location LIKE 'CHG-%') AS others_updated,
      count(*) FILTER (WHERE upd AND NOT moved AND NOT deleted AND location NOT LIKE 'CHG-%') AS others_stale,
      count(*) FILTER (WHERE NOT upd AND NOT deleted AND start > now()) AS removed_still_live
    FROM (SELECT s.deleted, s.location, s.\"scheduledStartTime\" AS start, s.\"lastMovedAt\" IS NOT NULL AS moved, s.\"externalKey\" ~ '($UPD_IDS)' AS upd
          FROM \"Session\" s WHERE s.source = 'PORTAL' AND s.\"externalKey\" ~ '($UPD_IDS|$REM_IDS)') x" >"$OUT/$label.custom.post.txt"
  # Exams must never touch the cache: no exam table remains, and no cache row
  # carries an exam key.
  psql_ -c "SELECT count(*) FROM information_schema.tables WHERE table_name ILIKE '%exam%'" >"$OUT/$label.examcache.txt"
  psql_ -c "SELECT count(*) FROM \"LmsCourseOccurrence\" WHERE \"externalKey\" LIKE 'portal:exam%'" >>"$OUT/$label.examcache.txt"
  stop_procs
  cp "$OUT/portal-timetable.orig.json" "$HERE/portal-timetable.json"
}

for rep in $(seq "$REPEATS"); do
  run "A-$rep" false
  run "B-$rep" true
done

node "$HERE/bench-report.js" "$OUT"
