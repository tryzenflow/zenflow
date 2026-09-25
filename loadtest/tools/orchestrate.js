#!/usr/bin/env node
// Load-test orchestrator (Node >= 20, run from Git Bash / PowerShell on the host).
//
//   node loadtest/tools/orchestrate.js seed  <A|B|C>        fresh infra + seed all fixed-load levels for one variant
//   node loadtest/tools/orchestrate.js run   [--passes 1,2,3] [--variants A,B,C] [--only tag,tag] [--no-steady]
//   node loadtest/tools/orchestrate.js down  <A|B|C>        remove one variant's containers + volumes
//
// What it adds over a bare k6 loop (each item fixes a problem of run 1):
//   * every service is a container with explicit limits (compose.loadtest.yml); `docker stats` sampled per scenario
//   * variant order alternates across passes (A,B,C / C,B,A / B,C,A)
//   * host kept awake without touching the power plan (keep-awake.sh: caffeinate / systemd-inhibit / SetThreadExecutionState on Windows), and a wall-clock
//     heartbeat is logged every 3 s; a >15 s gap inside a scenario invalidates it (rerun)
//   * supervisor: API/bandit container state is polled every second while k6 runs; a crash/restart/OOM kills k6
//     immediately, marks the scenario invalid, restarts the API and reruns (no long drains on a dead API)
//   * drain wait is capped (30 s), the outcome is recorded
const { spawn, execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { promisify } = require("node:util");
const execFileP = promisify(execFile);

const ROOT = path.resolve(__dirname, "..");
const RESULTS = path.join(ROOT, "results");
const COMPOSE = path.join(ROOT, "compose.loadtest.yml");
const BASE = "http://localhost:5641/api/v1";
const MAIL = "http://localhost:8541";
const BANDIT = "http://localhost:8641";
const HB_GAP_SEC = 15;
const DRAIN_CAP_SEC = 45;

const VARIANTS = {
  A: { label: "BEFORE (f821194)", mode: "legacy", bench: "0" },
  B: { label: "AFTER-legacy (HEAD, legacy mode)", mode: "legacy", bench: "1" },
  C: { label: "AFTER-python (HEAD, python mode)", mode: "python", bench: "1" },
};
const PASS_ORDER = { 1: ["A", "B", "C"], 2: ["C", "B", "A"], 3: ["B", "C", "A"] };

// ---- scenario matrix -------------------------------------------------------------------------------------
const MIX = { ops: "mix", taskDays: 30, seriesN: 8, seriesDays: 30 };
const SCENARIOS = [
  // headline: standard mix (single task with a 30-day scan + 8-sitting series), fixed-load level x closed-loop VUs
  ...[1, 10, 25, 50].map((v) => ({ tag: `mix_medium_v${v}`, family: "headline", level: "medium", vus: v, ...MIX })),
  ...["light", "heavy"].flatMap((l) => [10, 50].map((v) => ({ tag: `mix_${l}_v${v}`, family: "headline", level: l, vus: v, ...MIX }))),
  // scan window (single task only): deadline 7 / 30 / 60 days out
  ...[7, 30, 60].map((d) => ({ tag: `scan_${d}d`, family: "scan", level: "medium", vus: 10, ops: "task", taskDays: d })),
  // series size (series only): 3 (reference), 8, 12 sittings over 30 days, 20 sittings over 60 days
  ...[[3, 30], [8, 30], [12, 30], [20, 60]].map(([n, d]) => ({ tag: `series_${n}x_${d}d`, family: "series", level: "medium", vus: 10, ops: "series", seriesN: n, seriesDays: d })),
  // infeasible path: own family, never merged into headline numbers
  { tag: "infeasible_medium_v10", family: "infeasible", level: "medium", vus: 10, ops: "infeasible" },
  // 5-minute steady state (drift check, runs before the arrival scenario, which may leave a backlog); pass 1 only to stay inside the time budget
  { tag: "steady_medium_v10", family: "steady", level: "medium", vus: 10, mode: "steady", dur: "300s", steadyOnlyPass1: true, ...MIX },
  // open model: ramping arrival rate (iterations/s) on the standard mix, medium load
  { tag: "arrival_medium", family: "arrival", level: "medium", vus: 20, mode: "arrival", ramp: process.env.RAMP || "1:20s,2:20s,4:20s,8:20s", ...MIX },
];
const WARMUP = { tag: "warmup", family: "warmup", level: "medium", vus: 5, dur: "20s", ...MIX };

// ---- helpers -----------------------------------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const proj = (V) => `zflt-${V.toLowerCase()}`;
const cname = (V, svc) => `${proj(V)}-${svc}-1`;
const wtPath = (V) => path.resolve(ROOT, "..", "..", `zenflow-lt-${V}`);

function composeEnv(V) {
  return { ...process.env, COMPOSE_PROJECT_NAME: proj(V), API_IMAGE: `zf-lt-api:${V}`, BANDIT_IMAGE: `zf-lt-bandit:${V}`, PLACEMENT_MODE: process.env.PLACEMENT_MODE_OVERRIDE || VARIANTS[V].mode, BENCH_TIMING: VARIANTS[V].bench };
}
async function compose(V, ...args) {
  try {
    const { stdout } = await execFileP("docker", ["compose", "-f", COMPOSE, ...args], { env: composeEnv(V), maxBuffer: 64 << 20 });
    return stdout;
  } catch (e) {
    throw new Error(`docker compose ${args.join(" ")} failed: ${e.stderr || e.message}`);
  }
}
async function psql(V, sql) {
  const { stdout } = await execFileP("docker", ["exec", cname(V, "postgres"), "psql", "-U", "admin", "-d", "zenflow-test", "-At", "-c", sql], { maxBuffer: 64 << 20 });
  return stdout.trim();
}
async function inspect(name) {
  try {
    const { stdout } = await execFileP("docker", ["inspect", "-f", "{{.State.Status}}|{{.State.StartedAt}}|{{.State.OOMKilled}}|{{.RestartCount}}|{{.State.ExitCode}}", name]);
    const [status, startedAt, oom, restarts, exit] = stdout.trim().split("|");
    return { status, startedAt, oom: oom === "true", restarts: +restarts, exit: +exit };
  } catch {
    return { status: "missing" };
  }
}
async function httpOk(url, ms = 3000) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(ms) });
    return r.status;
  } catch {
    return 0;
  }
}
async function waitFor(fn, what, capSec) {
  const t0 = Date.now();
  while (Date.now() - t0 < capSec * 1000) {
    if (await fn()) return;
    await sleep(1000);
  }
  throw new Error(`timeout waiting for ${what}`);
}

// ---- keep-awake + heartbeat ------------------------------------------------------------------------------
let keepAwakeProc = null;
const hb = { lastTick: Date.now(), gaps: [], file: null, timer: null };
function startHostGuards() {
  fs.mkdirSync(RESULTS, { recursive: true });
  keepAwakeProc = spawn("bash", [path.join(__dirname, "keep-awake.sh")], { stdio: "ignore" });
  hb.file = fs.createWriteStream(path.join(RESULTS, "heartbeat.log"), { flags: "a" });
  let n = 0;
  hb.lastTick = Date.now();
  hb.timer = setInterval(() => {
    const now = Date.now();
    const gap = (now - hb.lastTick) / 1000;
    if (gap > HB_GAP_SEC) {
      hb.gaps.push({ at: now, gapSec: gap });
      hb.file.write(`${new Date(now).toISOString()} GAP ${gap.toFixed(1)}s (host sleep or stall)\n`);
      log(`!! heartbeat gap ${gap.toFixed(1)}s`);
    }
    if (++n % 3 === 0) hb.file.write(`${new Date(now).toISOString()} hb\n`);
    hb.lastTick = now;
  }, 1000);
}
function stopHostGuards() {
  if (hb.timer) clearInterval(hb.timer);
  if (keepAwakeProc) {
    try { spawn("taskkill", ["/F", "/T", "/PID", String(keepAwakeProc.pid)], { stdio: "ignore" }); } catch { /* ignore */ }
  }
}

// ---- variant lifecycle -------------------------------------------------------------------------------------
async function bringUp(V, restore) {
  await compose(V, "up", "-d", "postgres", "redis", "redis-ratelimit", "mail", "bandit");
  await waitFor(async () => { try { await psql(V, "select 1"); return true; } catch { return false; } }, "postgres", 60);
  if (restore) {
    // every variant-pass starts from the identical seeded snapshot (no drift/bloat/matrix reinforcement carried over)
    const pg = (db, sql) => execFileP("docker", ["exec", cname(V, "postgres"), "psql", "-U", "admin", "-d", db, "-c", sql]);
    await pg("postgres", 'DROP DATABASE IF EXISTS "zenflow-test" WITH (FORCE)');
    await pg("postgres", 'CREATE DATABASE "zenflow-test"');
    await execFileP("docker", ["exec", cname(V, "postgres"), "pg_restore", "-U", "admin", "-d", "zenflow-test", "--no-owner", "/tmp/seed.dump"]);
  }
  await psql(V, "CREATE EXTENSION IF NOT EXISTS pg_stat_statements");
  await compose(V, "up", "-d", "api");
  await waitFor(async () => (await httpOk(`${BASE}/auth/me`)) > 0, "api", 120);
  await waitFor(async () => (await httpOk(`${BANDIT}/health`)) === 200, "bandit", 60);
}
async function bringDown(V, wipe) {
  if (wipe) await compose(V, "down", "-v").catch(() => {});
  else await compose(V, "stop", "-t", "20").catch(() => {});
}
async function restartApi(V) {
  await compose(V, "up", "-d", "api");
  await execFileP("docker", ["start", cname(V, "api")]).catch(() => {});
  await waitFor(async () => (await httpOk(`${BASE}/auth/me`)) > 0, "api restart", 120);
}

function k6(args, { env = {}, outFile, killOn } = {}) {
  return new Promise((resolve) => {
    const out = outFile ? fs.createWriteStream(outFile) : null;
    const p = spawn("k6", ["run", "--no-color", "-q", ...args], { env: { ...process.env, ...env }, windowsHide: true });
    if (out) { p.stdout.pipe(out, { end: false }); p.stderr.pipe(out, { end: false }); }
    p.on("close", (code) => { if (out) out.end(); resolve(code); });
    if (killOn) killOn(() => spawn("taskkill", ["/F", "/T", "/PID", String(p.pid)], { stdio: "ignore" }));
  });
}

async function seedVariant(V) {
  const dir = path.join(RESULTS, V, "seed");
  fs.mkdirSync(dir, { recursive: true });
  log(`seed ${V}: fresh infra`);
  await bringDown(V, true);
  await bringUp(V, false);
  for (const level of ["light", "medium", "heavy"]) {
    const t0 = Date.now();
    const cookieLog = path.join(dir, `${level}.console.txt`);
    const code = await k6(["--console-output", cookieLog, "-e", `BASE=${BASE}`, "-e", `MAIL=${MAIL}`, "-e", `LEVEL=${level}`, "-e", "USERS=50", "-e", "PAR=10", path.join(ROOT, "scripts", "seed.js")], { outFile: path.join(dir, `${level}.k6.txt`) });
    const lines = fs.readFileSync(cookieLog, "utf8").split(/\r?\n/);
    const cookies = {};
    let fails = 0;
    for (const l of lines) {
      const m = l.match(/COOKIE\\t([^\\]+)\\t([^"]+)/) || l.match(/COOKIE\t([^\t]+)\t(.+?)"?$/);
      if (m) cookies[m[1]] = m[2].replace(/\\"/g, '"');
      if (l.includes("SEEDFAIL")) fails++;
    }
    fs.writeFileSync(path.join(RESULTS, V, `cookies-${level}.json`), JSON.stringify(cookies));
    const cnt = await psql(V, `select count(*) from "Session" s join "User" u on u.id=s."userId" where u.email like 'lt-${level}-%'`).catch(() => "?");
    log(`seed ${V} ${level}: k6 exit ${code}, ${Object.keys(cookies).length} cookies, ${fails} failed POSTs, ${cnt} session rows, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  // Workaround for integration bug #1 (see README): a cold-start user has preferenceMatrix=[] and Python
  // rejects it with 422, so every placement of a not-yet-learned user degrades to the TS fallback. Give every
  // load-test user the same deterministic, non-trivial 168-entry matrix (7 days x 24 h) so python mode is exercised.
  await psql(V, `UPDATE "User" SET "preferenceMatrix" = (SELECT array_agg(round((sin(((g % 24) - 6) / 24.0 * 2 * pi()) * 2 + (CASE WHEN g / 24 >= 5 THEN 0.5 ELSE 0 END))::numeric, 3)::float8 ORDER BY g) FROM generate_series(0,167) g) WHERE email LIKE 'lt-%'`);
  await compose(V, "stop", "api");
  await execFileP("docker", ["exec", cname(V, "postgres"), "pg_dump", "-U", "admin", "-Fc", "-f", "/tmp/seed.dump", "zenflow-test"]);
  fs.writeFileSync(path.join(RESULTS, V, "seeded.json"), JSON.stringify({ at: new Date().toISOString() }));
  await bringDown(V, false);
}

// ---- one scenario ----------------------------------------------------------------------------------------
async function drain(status) {
  const t0 = Date.now();
  let ok = 0;
  while (Date.now() - t0 < DRAIN_CAP_SEC * 1000) {
    const s = performance.now();
    const code = await httpOk(`${BASE}/auth/me`, 5000);
    const ms = performance.now() - s;
    if (code > 0 && ms < 100) ok++; else ok = 0;
    if (ok >= 3) break;
    await sleep(1000);
  }
  status.drainSec = +((Date.now() - t0) / 1000).toFixed(1);
  status.drained = ok >= 3;
}

function parseStats(samples) {
  const by = {};
  for (const s of samples) (by[s.name] ||= []).push(s);
  const out = {};
  const toMiB = (t) => { const m = String(t).match(/([\d.]+)\s*(B|KiB|MiB|GiB)/); if (!m) return 0; return +m[1] * { B: 1 / 1048576, KiB: 1 / 1024, MiB: 1, GiB: 1024 }[m[2]]; };
  for (const [name, arr] of Object.entries(by)) {
    const cpu = arr.map((s) => parseFloat(s.cpu));
    const mem = arr.map((s) => toMiB(s.mem.split("/")[0]));
    const svc = name.replace(/^zflt-[abc]-/, "").replace(/-1$/, "");
    out[svc] = { samples: arr.length, cpuAvgPct: +(cpu.reduce((a, b) => a + b, 0) / cpu.length).toFixed(1), cpuMaxPct: +Math.max(...cpu).toFixed(1), memAvgMiB: +(mem.reduce((a, b) => a + b, 0) / mem.length).toFixed(0), memMaxMiB: +Math.max(...mem).toFixed(0) };
  }
  return out;
}

async function runScenario(V, pass, sc, attempt) {
  const dir = path.join(RESULTS, V, `p${pass}`);
  fs.mkdirSync(dir, { recursive: true });
  const tag = sc.tag;
  const status = { variant: V, pass, tag, attempt, valid: true, reasons: [], startedAt: new Date().toISOString() };
  const t0 = Date.now();
  const gapsBefore = hb.gaps.length;
  log(`== ${V} p${pass} ${tag} (attempt ${attempt})`);
  await drain(status);
  if (!status.drained) { status.valid = false; status.reasons.push(`backlog_not_drained_after_${DRAIN_CAP_SEC}s`); }
  const apiBefore = await inspect(cname(V, "api"));
  const banBefore = await inspect(cname(V, "bandit"));
  if (apiBefore.status !== "running") { status.valid = false; status.reasons.push("api_not_running_at_start"); }
  await psql(V, "SELECT pg_stat_statements_reset()").catch(() => {});

  // docker stats stream
  const names = ["api", "bandit", "postgres", "redis", "redis-ratelimit"].map((s) => cname(V, s));
  const samples = [];
  const stats = spawn("docker", ["stats", "--format", "{{json .}}", ...names], { windowsHide: true });
  let buf = "";
  stats.stdout.on("data", (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      const j = line.indexOf("{");
      if (j < 0) continue;
      try { const o = JSON.parse(line.slice(j, line.lastIndexOf("}") + 1)); samples.push({ name: o.Name, cpu: o.CPUPerc, mem: o.MemUsage }); } catch { /* partial */ }
    }
  });

  // supervisor
  let kill = null;
  let supervising = true;
  const sup = (async () => {
    while (supervising) {
      const [a, b] = await Promise.all([inspect(cname(V, "api")), inspect(cname(V, "bandit"))]);
      for (const [svc, now, before] of [["api", a, apiBefore], ["bandit", b, banBefore]]) {
        if (now.status !== "running" || now.startedAt !== before.startedAt || now.oom || now.restarts !== before.restarts) {
          status.valid = false;
          status.reasons.push(`${svc}_crashed_or_restarted(${now.status},exit=${now.exit},oom=${now.oom})`);
          supervising = false;
          if (kill) kill();
          log(`!! ${svc} died during ${tag}: aborting scenario`);
        }
      }
      await sleep(1000);
    }
  })();

  const durSec = sc.mode === "arrival" ? sc.ramp.split(",").reduce((s, x) => s + parseInt(x.split(":")[1], 10), 0) : parseInt((sc.dur || "60s"), 10);
  const env = {
    BASE, MAIL, LEVEL: sc.level, VUS: String(sc.vus), MODE: sc.mode || "constant", DURATION: sc.dur || "60s", VARIANT: V, OPS: sc.ops,
    TASK_DAYS: String(sc.taskDays || 30), SERIES_N: String(sc.seriesN || 8), SERIES_DAYS: String(sc.seriesDays || 30), COOKIES: path.join(RESULTS, V, `cookies-${sc.level}.json`),
    OUT: path.join(dir, `${tag}.json`), ...(sc.ramp ? { RAMP: sc.ramp } : {}),
  };
  const args = [];
  for (const [k, v] of Object.entries(env)) args.push("-e", `${k}=${v}`);
  args.push(path.join(ROOT, "scripts", "run.js"));
  const tk = Date.now();
  status.k6Exit = await k6(args, { outFile: path.join(dir, `${tag}.k6.txt`), killOn: (fn) => { kill = fn; if (!supervising) fn(); } });
  status.k6Sec = +((Date.now() - tk) / 1000).toFixed(1);
  supervising = false;
  await sup;
  stats.kill();
  spawn("taskkill", ["/F", "/T", "/PID", String(stats.pid)], { stdio: "ignore" });

  status.docker = parseStats(samples);
  try {
    status.pgTotal = JSON.parse(await psql(V, `SELECT json_build_object('calls',COALESCE(sum(calls),0),'total_ms',COALESCE(round(sum(total_exec_time)::numeric,1),0)) FROM pg_stat_statements WHERE dbid=(SELECT oid FROM pg_database WHERE datname='zenflow-test') AND query NOT ILIKE '%pg_stat%'`));
    status.pgTop = JSON.parse(await psql(V, `SELECT COALESCE(json_agg(t),'[]') FROM (SELECT left(regexp_replace(query,'\\s+',' ','g'),160) AS query, calls, round(total_exec_time::numeric,1) AS total_ms, round(mean_exec_time::numeric,3) AS mean_ms FROM pg_stat_statements WHERE dbid=(SELECT oid FROM pg_database WHERE datname='zenflow-test') AND query NOT ILIKE '%pg_stat%' ORDER BY total_exec_time DESC LIMIT 15) t`));
  } catch (e) { status.pgError = String(e.message).slice(0, 200); }
  if (hb.gaps.length > gapsBefore) { status.valid = false; status.reasons.push(`heartbeat_gap(${hb.gaps.slice(gapsBefore).map((g) => g.gapSec.toFixed(0) + "s").join(",")})`); }
  if (!fs.existsSync(path.join(dir, `${tag}.json`))) { status.valid = false; status.reasons.push("no_k6_summary"); }
  if (!status.valid) {
    const logs = await execFileP("docker", ["logs", "--tail", "60", cname(V, "api")]).then((r) => r.stdout + r.stderr).catch(() => "");
    fs.writeFileSync(path.join(dir, `${tag}.a${attempt}.apilog.txt`), logs);
  }
  status.endedAt = new Date().toISOString();
  status.wallSec = +((Date.now() - t0) / 1000).toFixed(1);
  fs.writeFileSync(path.join(dir, `${tag}.status.json`), JSON.stringify(status, null, 1));
  if (!status.valid) fs.renameSync(path.join(dir, `${tag}.json`), path.join(dir, `${tag}.a${attempt}.INVALID.json`)) ;
  return status;
}

async function runWithRetry(V, pass, sc) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    let st;
    try { st = await runScenario(V, pass, sc, attempt); } catch (e) { st = { valid: false, reasons: [`orchestrator_error:${e.message}`] }; log("orchestrator error", e.message); }
    if (st.valid) return st;
    log(`   invalid (${st.reasons.join("; ")}) -> ${attempt < 3 ? "rerun" : "giving up"}`);
    const api = await inspect(cname(V, "api"));
    if (api.status !== "running") await restartApi(V).catch((e) => log("restart failed", e.message));
    fs.appendFileSync(path.join(RESULTS, "invalid.log"), JSON.stringify({ variant: V, pass, tag: sc.tag, attempt, reasons: st.reasons }) + "\n");
  }
  return null;
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const flag = (n, d) => { const i = rest.indexOf(`--${n}`); return i >= 0 ? rest[i + 1] : d; };
  startHostGuards();
  process.on("SIGINT", () => { stopHostGuards(); process.exit(130); });
  try {
    if (cmd === "seed") await seedVariant(rest[0]);
    else if (cmd === "up") await bringUp(rest[0], true);
    else if (cmd === "stop") await bringDown(rest[0], false);
    else if (cmd === "down") await bringDown(rest[0], true);
    else if (cmd === "run") {
      const passes = flag("passes", "1,2,3").split(",").map(Number);
      const only = flag("only", "") ? flag("only").split(",") : null;
      const allowed = flag("variants", "A,B,C").split(",");
      const noSteady = rest.includes("--no-steady");
      for (const pass of passes) {
        for (const V of PASS_ORDER[pass].filter((v) => allowed.includes(v))) {
          if (!fs.existsSync(path.join(RESULTS, V, "seeded.json"))) await seedVariant(V);
          log(`--- pass ${pass} variant ${V} ${VARIANTS[V].label}`);
          await bringUp(V, true);
          await runScenario(V, pass, WARMUP, 1).catch((e) => log("warmup error", e.message));
          for (const sc of SCENARIOS) {
            if (only && !only.includes(sc.tag)) continue;
            if (sc.steadyOnlyPass1 && (pass !== 1 || noSteady)) continue;
            await runWithRetry(V, pass, sc);
          }
          await bringDown(V, false);
        }
      }
      log("ALL DONE");
    } else console.log("usage: seed <V> | run [--passes 1,2,3] [--variants A,B,C] [--only tag,..] [--no-steady] | down <V>");
  } finally {
    stopHostGuards();
  }
}
module.exports = { SCENARIOS };
if (require.main === module) main().catch((e) => { console.error(e); stopHostGuards(); process.exit(1); });
