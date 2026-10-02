/**
 * Observes the fake DLU server for N ingestion ticks and reports how many
 * upstream requests each tick made — the "after" half of the issue-#56
 * measurement that `seed-and-sync.js` sets up.
 *
 * Resets `fake-dlu-server.ts`'s counters, then samples `/_/stats` once per tick
 * interval and diffs consecutive samples, so each row is one tick's volume.
 * Requests are split three ways, because #56 moves volume between them rather
 * than just shrinking a total:
 *
 *  - auth       login form/submit/sesskey, portal and DKHP authenticate — per student
 *  - data       timetable weeks, exam list, calendar months — TERM-scoped, the
 *               redundancy the occurrence cache exists to collapse
 *  - discovery  DKHP registration history, enrolled courses — per student, the
 *               volume #56 ADDS in exchange
 *
 * Prereqs: everything `seed-and-sync.js` needs, already seeded, with the backend
 * restarted under the gate combination being measured.
 *
 * Run: node measure.js [--ticks 5] [--label A] [--json out.json] [--started-file f]
 * (--started-file is written right after the counters reset, so a mutator can
 * time its edits from the start of the measurement)
 * Env: FAKE_DLU_URL (default http://localhost:4100)
 */
"use strict";
const fs = require("fs");

const FAKE_DLU = process.env.FAKE_DLU_URL ?? "http://localhost:4100";
const TICK_MS = 60_000;

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : fallback;
}
const TICKS = Number(arg("ticks", "5"));
const STARTED_FILE = arg("started-file", null);
const LABEL = arg("label", "run");
const JSON_OUT = arg("json", null);

function categoryOf(key) {
  if (/^(lms:login_|lms:my_sesskey|portal:authenticate|dkhp:authenticate)/.test(key)) return "auth";
  if (/^(dkhp:history|lms:enrolled)/.test(key)) return "discovery";
  return "data";
}

function summarise(byKey) {
  const out = { total: 0, auth: 0, data: 0, discovery: 0, dataKeys: 0 };
  for (const [key, n] of Object.entries(byKey)) {
    const cat = categoryOf(key);
    out[cat] += n;
    out.total += n;
    if (cat === "data" && n > 0) out.dataKeys += 1;
  }
  return out;
}

function diff(now, before) {
  const out = {};
  for (const [key, n] of Object.entries(now)) {
    const d = n - (before[key] ?? 0);
    if (d > 0) out[key] = d;
  }
  return out;
}

async function stats() {
  const res = await fetch(`${FAKE_DLU}/_/stats`);
  return (await res.json()).byKey;
}

/**
 * Sleep until `offsetMs` before the next wall-clock minute. The ticker's cron
 * fires on the minute, so sampling just before each boundary makes each sample
 * one tick's worth rather than the tail of one and the head of the next.
 */
function untilJustBeforeMinute(offsetMs = 2_000) {
  const now = Date.now();
  let wait = TICK_MS - (now % TICK_MS) - offsetMs;
  if (wait < 0) wait += TICK_MS;
  return new Promise((r) => setTimeout(r, wait));
}

async function main() {
  await untilJustBeforeMinute();
  await fetch(`${FAKE_DLU}/_/reset`, { method: "POST" });
  if (STARTED_FILE) fs.writeFileSync(STARTED_FILE, String(Date.now()));
  console.log(`[${LABEL}] reset; sampling ${TICKS} ticks of ${TICK_MS / 1000}s`);

  const perTick = [];
  let previous = {};
  for (let t = 1; t <= TICKS; t++) {
    await new Promise((r) => setTimeout(r, 1_000));
    await untilJustBeforeMinute();
    const current = await stats();
    const tick = summarise(diff(current, previous));
    perTick.push(tick);
    previous = current;
    console.log(
      `[${LABEL}] tick ${t}: total=${tick.total} auth=${tick.auth} data=${tick.data} discovery=${tick.discovery}`,
    );
  }

  const overall = summarise(previous);
  const distinctResources = Object.keys(previous).filter((k) => categoryOf(k) === "data").length;
  const report = { label: LABEL, ticks: TICKS, overall, distinctDataResources: distinctResources, perTick, byKey: previous };
  console.log(`[${LABEL}] overall:`, JSON.stringify({ ...overall, distinctDataResources: distinctResources }));
  if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
