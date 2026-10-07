/**
 * Reads the files bench.sh left in <dir> and prints the A (no cache) vs B
 * (cache + fan-out) comparison over all repeats, plus the correctness checks.
 */
"use strict";
const fs = require("fs");
const path = require("path");

const dir = process.argv[2] ?? "/tmp/dlu-bench";
const read = (f) => fs.readFileSync(path.join(dir, f), "utf8");
const exists = (f) => fs.existsSync(path.join(dir, f));
let failed = false;
const fail = (msg) => {
  failed = true;
  console.log(`  FAIL: ${msg}`);
};

const repeats = [];
for (let i = 1; exists(`A-${i}.json`) && exists(`B-${i}.json`); i++) repeats.push(i);

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const fmt = (xs, d = 0) => {
  const f = (v) => Number(v).toFixed(d);
  return `${f(median(xs))} [${f(Math.min(...xs))}-${f(Math.max(...xs))}]`;
};

/** Everything measured for one run. */
function load(label) {
  const r = JSON.parse(read(`${label}.json`));
  const started = Number(read(`${label}.started`));
  const log = JSON.parse(read(`${label}.log.json`));
  const ticks = r.perTick.length;

  // Busy seconds per tick: last minus first request in each minute bucket. The
  // ticker fires 2 s after the counters reset.
  const first = new Array(ticks).fill(Infinity);
  const last = new Array(ticks).fill(-Infinity);
  const examByStudent = new Map();
  for (const e of log) {
    const b = Math.floor((e.t - started - 2000) / 60000);
    if (b >= 0 && b < ticks) {
      first[b] = Math.min(first[b], e.t);
      last[b] = Math.max(last[b], e.t);
    }
    if (e.key.startsWith("portal:exam:") && e.student) {
      examByStudent.set(e.student, (examByStudent.get(e.student) ?? 0) + 1);
    }
  }
  const busy = first.map((f, i) => (f === Infinity ? 0 : (last[i] - f) / 1000));

  const sessions = read(`${label}.sessions.txt`);
  const rows = sessions.trim().split("\n");
  const num = (f) => read(f).trim().split("|").map(Number);
  const pre = Object.fromEntries(read(`${label}.custom.pre.txt`).trim().split("\n").map((l) => l.split("|")).map(([k, v]) => [k, Number(v)]));
  const [movedKept, movedOverwritten, deletedKept, othersUpdated, othersStale, removedLive] = num(`${label}.custom.post.txt`);
  const changedLive = rows.filter((l) => l.includes("|CHG-") && l.endsWith("|f")).length;
  const deleted = rows.filter((l) => l.endsWith("|t")).length;

  const examCounts = [...examByStudent.values()];
  return {
    label,
    perTick: r.perTick,
    overall: r.overall,
    busy,
    skipped: (read(`${label}.backend.log`).match(/Skipping tick/g) ?? []).length,
    sessions,
    sessionRows: rows.length,
    changedLive,
    deleted,
    pre,
    custom: { movedKept, movedOverwritten, deletedKept, othersUpdated, othersStale, removedLive },
    examStudents: examByStudent.size,
    examMin: examCounts.length ? Math.min(...examCounts) : 0,
    examTotal: examCounts.reduce((a, b) => a + b, 0),
    examDb: read(`${label}.examcache.txt`).trim().split("\n").join("/"),
    log,
    log_keys: log.length,
  };
}

const runs = { A: repeats.map((i) => load(`A-${i}`)), B: repeats.map((i) => load(`B-${i}`)) };
const ticks = runs.A[0].perTick.length;
const phaseName = (t) => (t < 2 ? "w1 new" : t < 4 ? "w2 changes" : "tail");

console.log(`${repeats.length} repeats per case, ${ticks} ticks per run. Cells: median [min-max].\n`);

if (exists("setup.warm.stats.json")) {
  const w = JSON.parse(read("setup.warm.stats.json"));
  const hist = Object.entries(w.byKey).filter(([k]) => k.startsWith("dkhp:history")).reduce((a, [, v]) => a + v, 0);
  const enr = Object.entries(w.byKey).filter(([k]) => k.startsWith("lms:enrolled")).reduce((a, [, v]) => a + v, 0);
  console.log(`One-time discovery (outside the runs): ${w.total} requests (${hist} DKHP history, ${enr} LMS enrolled, rest auth)`);
}
if (exists("setup.gate.log.json")) {
  const log = JSON.parse(read("setup.gate.log.json"));
  const firstHistory = new Map();
  let violations = 0;
  log.forEach((e, i) => {
    if (e.key.startsWith("dkhp:history:") && e.student && !firstHistory.has(e.student)) firstHistory.set(e.student, i);
    if (e.key.startsWith("portal:timetable:") && e.student && !firstHistory.has(e.student)) violations++;
  });
  const timetable = log.filter((e) => e.key.startsWith("portal:timetable:")).length;
  console.log(`Gate check: ${violations} timetable requests before the student's DKHP history (${firstHistory.size} students had history, ${timetable} timetable requests seen)`);
  if (violations || timetable === 0) fail("discovery-before-timetable gate");
}

console.log("\nRequests per tick (total / data), by phase");
console.log("tick phase       A total               B total               A data                B data");
for (let t = 0; t < ticks; t++) {
  const col = (cfg, key) => fmt(runs[cfg].map((r) => r.perTick[t][key]));
  console.log(
    `${String(t + 1).padStart(3)}  ${phaseName(t).padEnd(10)} ${col("A", "total").padEnd(21)} ${col("B", "total").padEnd(21)} ${col("A", "data").padEnd(21)} ${col("B", "data")}`,
  );
}

console.log("\nWhole run");
console.log("case  total               auth                data                discovery     busy s/tick (mean)  skipped ticks");
for (const cfg of ["A", "B"]) {
  const rs = runs[cfg];
  const o = (k) => fmt(rs.map((r) => r.overall[k]));
  const busy = fmt(rs.map((r) => r.busy.reduce((a, b) => a + b, 0) / ticks), 1);
  console.log(`${cfg}     ${o("total").padEnd(19)} ${o("auth").padEnd(19)} ${o("data").padEnd(19)} ${o("discovery").padEnd(13)} ${busy.padEnd(19)} ${fmt(rs.map((r) => r.skipped))}`);
}
const dA = median(runs.A.map((r) => r.overall.data));
const dB = median(runs.B.map((r) => r.overall.data));
const tA = median(runs.A.map((r) => r.overall.total));
const tB = median(runs.B.map((r) => r.overall.total));
console.log(`Median reduction with cache: total ${(100 * (1 - tB / tA)).toFixed(0)}%, data ${(100 * (1 - dB / dA)).toFixed(0)}%`);
console.log("Busy seconds per tick, run 1:");
for (const cfg of ["A", "B"]) console.log(`  ${cfg}: ${runs[cfg][0].busy.map((b) => b.toFixed(0)).join(" ")}`);

console.log("\nChecks");
const all = [...runs.A, ...runs.B];
const ref = all[0];
const same = all.every((r) => r.sessions === ref.sessions);
console.log(`  Calendars: ${same ? "IDENTICAL" : "DIFFER"} across all ${all.length} runs (${ref.sessionRows} rows; ${ref.changedLive} live rows in changed rooms, ${ref.deleted} soft-deleted)`);
if (!same) {
  for (const r of all) console.log(`    ${r.label}: ${r.sessionRows} rows, ${r.changedLive} changed-room live, ${r.deleted} deleted`);
  fail("calendars differ between runs");
}
console.log("  Student moves/deletes (per run: customised before the changes -> state after):");
for (const r of all) {
  const c = r.custom;
  const p = r.pre;
  console.log(`    ${r.label}: moved ${p.moved_update} -> kept ${c.movedKept}, overwritten ${c.movedOverwritten}; deleted ${p.deleted_update} -> still deleted ${c.deletedKept}; other students updated ${c.othersUpdated}, stale ${c.othersStale}; removed sections still live ${c.removedLive}`);
  if (!(p.moved_update > 0 && p.deleted_update > 0)) fail(`${r.label}: no student moves/deletes were set up (${JSON.stringify(p)})`);
  if (c.movedKept !== p.moved_update || c.movedOverwritten !== 0) fail(`${r.label}: a student-moved lecture was overwritten`);
  if (c.deletedKept !== p.deleted_update) fail(`${r.label}: a student-deleted lecture was recreated or extra rows were deleted`);
  if (c.othersStale !== 0 || c.othersUpdated === 0) fail(`${r.label}: other students did not get the room change`);
  if (c.removedLive !== 0) fail(`${r.label}: removed sections still live`);
}
if (ref.changedLive === 0) fail("no changed-room sessions found; the update phase did not land");
if (ref.deleted === 0) fail("no soft-deleted sessions found; the removal phase did not land");
for (const r of all) {
  if (r.examDb !== "0/0") fail(`${r.label}: exam table or cache row exists (${r.examDb})`);
  if (r.examStudents === 0 || r.examMin < 1) fail(`${r.label}: some student had no upstream exam request`);
}
const exam = (cfg) => fmt(runs[cfg].map((r) => r.examTotal / Math.max(1, r.examStudents)), 1);
console.log(`  Exams: every student hit upstream in every run; exam passes per student A ${exam("A")}, B ${exam("B")}; no exam cache table or row`);

if (failed) {
  console.log("\nCHECKS FAILED");
  process.exitCode = 1;
}
