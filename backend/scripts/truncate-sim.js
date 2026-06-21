#!/usr/bin/env node
/**
 * truncate-sim.js — fast reset of the simulation database.
 *
 * A drop-in, MUCH faster alternative to `sim:reset`
 * (`prisma db push --force-reset`, which DROPS and recreates the entire schema).
 * Instead it `TRUNCATE`s only the data tables the seeder writes, RESTART IDENTITY
 * CASCADE — the schema (and any migration state) is left intact, so the next
 * `sim:run` starts from an empty-but-migrated DB in milliseconds.
 *
 * Connects via `DATABASE_URL` (the same selector `.env.sim` sets), so it resets
 * WHICHEVER sim database that URL points at — the default single `zenflow_sim`,
 * or a per-arm DB when `DATABASE_URL` is overridden. No docker/psql client
 * required; uses the `pg` driver already in the backend deps.
 *
 *   pnpm --filter backend sim:reset:fast          # truncate the .env.sim DB
 *   DATABASE_URL=... node scripts/truncate-sim.js # truncate a chosen DB
 *
 * Safety: refuses to run unless the target DB name looks like a sim DB
 * (contains "sim"), so it can never be pointed at dev/prod by accident.
 */
"use strict";

const { Client } = require("pg");

// Tables in dependency-safe order is irrelevant under CASCADE, but listing every
// data table the seeder touches keeps the reset explicit (mirrors run-mar-arms.sh
// and scripts/sim-db.sh).
const TABLES = ['"TaskEvent"', '"Task"', '"Tag"', '"_TagToTask"', '"File"', '"User"'];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("FATAL: DATABASE_URL is not set (expected .env.sim).");
    process.exit(1);
  }

  let dbName = "";
  try {
    dbName = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  } catch {
    /* fall through to the guard below */
  }
  if (!/sim/i.test(dbName)) {
    console.error(
      `FATAL: refusing to truncate '${dbName}' — DATABASE_URL must point at a ` +
        `simulation database (name containing 'sim'). Got: ${url}`,
    );
    process.exit(1);
  }

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(
      `TRUNCATE TABLE ${TABLES.join(", ")} RESTART IDENTITY CASCADE;`,
    );
    console.error(`[sim:reset:fast] truncated ${TABLES.length} tables in '${dbName}'`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
