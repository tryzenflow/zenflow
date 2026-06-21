#!/usr/bin/env bash
# sim-db.sh — provision / fast-reset the per-arm simulation databases.
#
# All sim arms share ONE postgres container (the dev `zenflow-db`) but each arm
# gets its OWN logical database (`zenflow_sim_<arm>`), so arms run concurrently
# without resetting and reseeding a single shared DB between them. Creating a
# database is cheap; we clone the schema from a pre-migrated TEMPLATE
# (`CREATE DATABASE x TEMPLATE zenflow_sim`) for a near-instant fresh DB, and
# TRUNCATE the data tables to re-fresh an EXISTING arm DB (much faster than
# `prisma db push --force-reset`, which drops & recreates the whole schema).
#
# Subcommands:
#   ensure-template               Ensure the TEMPLATE DB (default zenflow_sim) exists
#                                 with the migrated schema. Pushes the schema once.
#   create   <arm> [<arm> ...]    Create each arm DB (clone of the template) if absent.
#   reset    <arm> [<arm> ...]    Fast-reset each arm DB: TRUNCATE the data tables
#                                 RESTART IDENTITY CASCADE (or clone from template if
#                                 the arm DB does not exist yet).
#   drop     <arm> [<arm> ...]    Drop each arm DB.
#   url      <arm>                Print the DATABASE_URL for an arm DB (for piping).
#
# Config via env (defaults target the local dev stack):
#   DB_CONTAINER=zenflow-db  DB_USER=admin  DB_PASS=admin  DB_HOST=localhost
#   DB_PORT=5432  TEMPLATE_DB=zenflow_sim_template  DB_PREFIX=zenflow_sim_
#
# The template is a SEPARATE, driver-owned DB (NOT the single `zenflow_sim`): a
# `CREATE DATABASE ... TEMPLATE x` clone requires ZERO other sessions on the
# source, and the dev backend / prisma may hold connections to `zenflow_sim`. A
# dedicated template nothing else connects to keeps the clone reliable. Before
# each clone we still terminate any stray sessions on the template as a safety net.
#
# A "data table TRUNCATE" mirrors run-mar-arms.sh: every table the seeder writes
# (TaskEvent, Task, Tag, _TagToTask, File, User) reset with identities restarted.
set -euo pipefail

DB_CONTAINER=${DB_CONTAINER:-zenflow-db}
DB_USER=${DB_USER:-admin}
DB_PASS=${DB_PASS:-admin}
DB_HOST=${DB_HOST:-localhost}
DB_PORT=${DB_PORT:-5432}
TEMPLATE_DB=${TEMPLATE_DB:-zenflow_sim_template}
DB_PREFIX=${DB_PREFIX:-zenflow_sim_}

HERE="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$(cd "$HERE/.." && pwd)"

# psql against the postgres "maintenance" DB (CREATE/DROP DATABASE can't run
# inside the target DB). All admin DDL goes through the container so no local
# psql client is required.
psql_admin() {
  docker exec -i "$DB_CONTAINER" psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d postgres "$@"
}

# psql against a specific database (for TRUNCATE / data DML).
psql_db() {
  local db="$1"; shift
  docker exec -i "$DB_CONTAINER" psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$db" "$@"
}

db_exists() {
  local db="$1"
  local out
  out=$(psql_admin -tAc "SELECT 1 FROM pg_database WHERE datname = '${db}';")
  [ "$out" = "1" ]
}

dbname_for() { echo "${DB_PREFIX}$1"; }

url_for() {
  local db="$1"
  echo "postgres://${DB_USER}:${DB_PASS}@${DB_HOST}:${DB_PORT}/${db}?sslmode=disable&schema=public"
}

truncate_data() {
  local db="$1"
  psql_db "$db" -c \
    'TRUNCATE TABLE "TaskEvent", "Task", "Tag", "_TagToTask", "File", "User" RESTART IDENTITY CASCADE;'
}

ensure_template() {
  if db_exists "$TEMPLATE_DB"; then
    echo "[sim-db] template '$TEMPLATE_DB' exists"
  else
    echo "[sim-db] creating template '$TEMPLATE_DB'"
    psql_admin -c "CREATE DATABASE \"${TEMPLATE_DB}\";"
  fi
  # Push the Prisma schema into the template so clones start migrated. Idempotent:
  # a no-op when the schema already matches. Targets the template DB only.
  echo "[sim-db] syncing schema into template '$TEMPLATE_DB'"
  ( cd "$BACKEND_DIR" \
    && DATABASE_URL="$(url_for "$TEMPLATE_DB")" \
       npx prisma db push --skip-generate --accept-data-loss >/dev/null )
  echo "[sim-db] template ready"
}

clone_from_template() {
  local db="$1"
  # A TEMPLATE clone copies the migrated schema instantly but requires zero other
  # sessions on the source. Terminate any strays first (the dedicated template DB
  # should have none, but `prisma db push` can leave a connection briefly).
  psql_admin -c \
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity \
     WHERE datname = '${TEMPLATE_DB}' AND pid <> pg_backend_pid();" >/dev/null
  psql_admin -c "CREATE DATABASE \"${db}\" TEMPLATE \"${TEMPLATE_DB}\";"
}

create_arm() {
  local arm="$1"
  local db; db=$(dbname_for "$arm")
  if db_exists "$db"; then
    echo "[sim-db] arm db '$db' already exists"
  else
    echo "[sim-db] creating arm db '$db' (TEMPLATE $TEMPLATE_DB)"
    clone_from_template "$db"
  fi
}

reset_arm() {
  local arm="$1"
  local db; db=$(dbname_for "$arm")
  if db_exists "$db"; then
    echo "[sim-db] fast-reset (TRUNCATE) arm db '$db'"
    truncate_data "$db"
  else
    echo "[sim-db] arm db '$db' absent → clone from template"
    clone_from_template "$db"
  fi
}

drop_arm() {
  local arm="$1"
  local db; db=$(dbname_for "$arm")
  if db_exists "$db"; then
    echo "[sim-db] dropping arm db '$db'"
    psql_admin -c "DROP DATABASE \"${db}\" WITH (FORCE);"
  fi
}

cmd=${1:-}
shift || true
case "$cmd" in
  ensure-template) ensure_template ;;
  create) ensure_template; for a in "$@"; do create_arm "$a"; done ;;
  reset)  for a in "$@"; do reset_arm "$a"; done ;;
  drop)   for a in "$@"; do drop_arm "$a"; done ;;
  url)    url_for "$(dbname_for "${1:?usage: sim-db.sh url <arm>}")" ;;
  *)
    echo "usage: sim-db.sh {ensure-template|create|reset|drop|url} <arm> [<arm> ...]" >&2
    exit 2
    ;;
esac
