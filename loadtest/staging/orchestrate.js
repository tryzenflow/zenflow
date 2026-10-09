#!/usr/bin/env node
// Drives the issue #77 staging load test. No worktrees/variants: it tests whatever image
// backend/compose.staging.yml builds.
//
//   node loadtest/staging/orchestrate.js up                  # build + start the stack, wait for health
//   node loadtest/staging/orchestrate.js seed                # seed users via the API (+ cookies.json), take a DB snapshot
//   node loadtest/staging/orchestrate.js run smoke           # restore snapshot, run one profile (smoke|full|soak)
//   node loadtest/staging/orchestrate.js run full            # warm-up, 1x/2x/3x holds, ramp-down in ONE run (~17 min)
//   node loadtest/staging/orchestrate.js run full --no-sync  # same without the background DLU sync load
//   node loadtest/staging/orchestrate.js auth                # OTP login burst (AUTH_RATE logins/s, default 5)
//   node loadtest/staging/orchestrate.js down                # stop and remove containers + volumes
//
// Env: BASE (default http://localhost/api/v1) MAIL (default http://localhost:8025)
//      SEED_LIGHT/MEDIUM/HEAVY (900/450/150) CONCURRENT THINK_S HOLD_S RAMP_S MAX_MULT SOAK_S SYNC_USERS SYNC_RATE
// Results land in loadtest/staging/results/<timestamp>-<profile>/ (git-ignored).
const { spawnSync, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const BACKEND = path.join(ROOT, "backend");
const RESULTS = path.join(__dirname, "results");
const COOKIES = path.join(RESULTS, "cookies.json");
const SNAPSHOT = path.join(RESULTS, "seed.dump");
const BASE = process.env.BASE || "http://localhost/api/v1";
const MAIL = process.env.MAIL || "http://localhost:8025";
const PG = "zenflow-db-staging";
const PROM = "zenflow-prometheus-staging";
const SEED = { light: +(process.env.SEED_LIGHT || 900), medium: +(process.env.SEED_MEDIUM || 450), heavy: +(process.env.SEED_HEAVY || 150) };

const compose = (...args) => sh("docker", ["compose", "--env-file", ".env.staging", "-f", "compose.staging.yml", ...args], { cwd: BACKEND });

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: opts.capture ? ["ignore", "pipe", "inherit"] : "inherit", encoding: "utf8", ...opts });
  if (r.status !== 0 && !opts.allowFail) throw new Error(`${cmd} ${args.join(" ")} exited ${r.status}`);
  return r;
}
const pgEnv = () => {
  const env = fs.readFileSync(path.join(BACKEND, ".env.staging"), "utf8");
  const get = (k) => (env.match(new RegExp(`^${k}=(.*)$`, "m")) || [])[1];
  return { user: get("POSTGRES_USER"), db: get("POSTGRES_DB") };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const k6Env = (extra = {}) => Object.entries({ BASE, MAIL, MAIL_KIND: "mailpit", ...extra }).flatMap(([k, v]) => ["-e", `${k}=${v}`]);

async function up() {
  compose("up", "-d", "--build");
  await waitApi();
}

async function waitApi() {
  // /auth/me answers 401 without a cookie: any answer other than a Caddy 502/503 means the API is up
  for (let i = 0; i < 150; i++) {
    const r = spawnSync("curl", ["-s", "-o", "/dev/null", "-w", "%{http_code}", "-m", "3", `${BASE}/auth/me`], { encoding: "utf8" });
    if (/^[1-5]\d\d$/.test(r.stdout) && !["502", "503", "504"].includes(r.stdout)) return console.log("api up, /auth/me ->", r.stdout);
    await sleep(2000);
  }
  throw new Error("api did not come up");
}

// k6's --console-output is logfmt: the tabs in `COOKIE\t<email>\t<cookie>` are escaped as a literal backslash-t.
function parseCookies(log) {
  const out = {};
  for (const line of fs.readFileSync(log, "utf8").split("\n")) {
    const m = line.match(/COOKIE\\t([^\\]+)\\t([^"]+)/);
    if (m) out[m[1]] = m[2];
    if (line.includes("SEEDFAIL")) console.warn(line.trim().slice(0, 200));
  }
  return out;
}

function seed() {
  fs.mkdirSync(RESULTS, { recursive: true });
  const all = {};
  for (const [level, users] of Object.entries(SEED)) {
    const log = path.join(RESULTS, `seed-${level}.log`);
    console.log(`seeding ${users} ${level} users...`);
    sh("k6", ["run", "--quiet", "--console-output", log, ...k6Env({ LEVEL: level, USERS: users, PAR: process.env.SEED_PAR || 10 }), path.join(ROOT, "loadtest/scripts/seed.js")]);
    Object.assign(all, parseCookies(log));
  }
  fs.writeFileSync(COOKIES, JSON.stringify(all));
  console.log(`${Object.keys(all).length} users seeded -> ${COOKIES}`);
  snapshot();
}

function snapshot() {
  const { user, db } = pgEnv();
  const r = sh("docker", ["exec", PG, "pg_dump", "-U", user, "-d", db, "-Fc"], { capture: true, encoding: "buffer", maxBuffer: 1 << 30 });
  fs.writeFileSync(SNAPSHOT, r.stdout);
  console.log(`snapshot ${SNAPSHOT} (${(r.stdout.length / 1e6).toFixed(1)} MB)`);
}

async function restore() {
  const { user, db } = pgEnv();
  console.log("restoring seed snapshot (api stopped)...");
  compose("stop", "api");
  sh("docker", ["exec", PG, "psql", "-U", user, "-d", "postgres", "-c", `DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`]);
  sh("docker", ["exec", PG, "psql", "-U", user, "-d", "postgres", "-c", `CREATE DATABASE "${db}"`]);
  // Strict: a partial restore must stop the run, not benchmark an incomplete seed. The dump creates pg_stat_statements
  // itself (pre-creating it made pg_restore exit non-zero, which is why this used to be allowed to fail).
  sh("docker", ["exec", "-i", PG, "pg_restore", "-U", user, "-d", db, "--no-owner", "--exit-on-error"], { input: fs.readFileSync(SNAPSHOT), stdio: ["pipe", "inherit", "inherit"] });
  const seeded = Object.keys(JSON.parse(fs.readFileSync(COOKIES, "utf8"))).length;
  const users = +sh("docker", ["exec", PG, "psql", "-U", user, "-d", db, "-At", "-c", 'SELECT count(*) FROM "User"'], { capture: true }).stdout.trim();
  if (!(users >= seeded)) throw new Error(`restore incomplete: ${users} users in the database, expected at least ${seeded}`);
  compose("up", "-d", "api");
  await up();
}

function promQuery(q, atMs) {
  const t = atMs ? `&time=${(atMs / 1000).toFixed(0)}` : "";
  const r = spawnSync("docker", ["exec", PROM, "wget", "-qO-", `http://localhost:9090/api/v1/query?query=${encodeURIComponent(q)}${t}`], { encoding: "utf8" });
  try { return JSON.parse(r.stdout).data.result; } catch { return null; }
}

// Server-side view of the phase: what Grafana would show. `w` = window, e.g. "12m".
// Per-container CPU/memory is NOT taken from cAdvisor: on Colima's containerd image store it reports only
// the aggregate /docker cgroup (see the cadvisor note in backend/compose.staging.yml), so we sample `docker stats` instead.
function promSnapshot(w, atMs) {
  const H = "http_server_request_duration_seconds";
  // route!="" pins the app's own series: OTel's HTTP auto-instrumentation emits the same metric name (label http_route,
  // identical counts), which would double every sum and let the sync route back in. A sync takes seconds by design: keep it
  // out of the aggregates and report it on its own.
  const NOT_SYNC = 'route!="",route!~".*/sync"';
  const q = (p, sel) => `histogram_quantile(${p}, sum by (le, http_request_method, route) (rate(${H}_bucket{${sel}}[${w}])))`;
  const pq = (p) => `histogram_quantile(${p}, sum by (le, assigned, compute_both, phase) (rate(scheduler_placement_python_duration_seconds_bucket{mode="PLACE"}[${w}])))`;
  const pe = (p) => `histogram_quantile(${p}, sum by (le, assigned, source) (rate(scheduler_placement_duration_seconds_bucket[${w}])))`;
  return {
    pgConnectionsMax: promQuery(`max_over_time(sum(pg_stat_activity_count)[${w}:15s])`, atMs),
    // server-side latency per METHOD + route (GET /sessions and POST /sessions are different things); sync excluded
    latencyP50: promQuery(q(0.5, NOT_SYNC), atMs),
    latencyP95: promQuery(q(0.95, NOT_SYNC), atMs),
    latencyP99: promQuery(q(0.99, NOT_SYNC), atMs),
    requestsByMethodRouteStatus: promQuery(`sum by (http_request_method, route, status_class) (increase(${H}_count{${NOT_SYNC}}[${w}]))`, atMs),
    aggregateP95ExcludingSync: promQuery(`histogram_quantile(0.95, sum by (le) (rate(${H}_bucket{${NOT_SYNC}}[${w}])))`, atMs),
    syncP95: promQuery(`histogram_quantile(0.95, sum by (le, route) (rate(${H}_bucket{route=~".*/sync"}[${w}])))`, atMs),
    syncRequests: promQuery(`sum by (route) (increase(${H}_count{route=~".*/sync"}[${w}]))`, atMs),
    // Heuristic vs LinUCB. `assigned` is the A/B roll; compute_both=true means Python ran both policies for that request
    // (LINUCB-primary, or a pairwise-sampled heuristic one). Python phases are what the service reports (scan = slot
    // search, predict = LinUCB scoring); `http` is the round trip. mode=PLACE only: preflights are always heuristic.
    policyPythonP50: promQuery(pq(0.5), atMs),
    policyPythonP95: promQuery(pq(0.95), atMs),
    policyPythonCount: promQuery(`sum by (assigned, compute_both) (increase(scheduler_placement_python_duration_seconds_count{mode="PLACE",phase="total"}[${w}]))`, atMs),
    policyEndToEndP50: promQuery(pe(0.5), atMs),
    policyEndToEndP95: promQuery(pe(0.95), atMs),
    policyEndToEndCount: promQuery(`sum by (assigned, source) (increase(scheduler_placement_duration_seconds_count[${w}]))`, atMs),
    banditFallback: promQuery(`sum by (reason) (increase(scheduler_bandit_fallback_total[${w}]))`, atMs),
    placementSource: promQuery(`sum by (source) (increase(scheduler_placement_source_total[${w}]))`, atMs),
    ingestionAgeSec: promQuery("time() - max by (provider) (ingestion_last_success_timestamp_seconds)", atMs),
  };
}

// Compose service names, not container names: `api` runs several replicas with generated names.
const WATCHED_SERVICES = ["api", "worker", "postgres", "bandit", "fake-dlu"];
// Running staging containers of the watched services, as { name: service }.
function watchedContainers() {
  const out = {};
  for (const svc of WATCHED_SERVICES) {
    const r = spawnSync("docker", ["ps", "--filter", `label=com.docker.compose.service=${svc}`, "--filter", "name=staging", "--format", "{{.Names}}"], { encoding: "utf8" });
    for (const name of (r.stdout || "").split("\n").filter(Boolean)) out[name] = svc;
  }
  return out;
}
const toMiB = (s) => { const m = s.match(/([\d.]+)\s*(B|KiB|MiB|GiB)/); return m ? +m[1] * { B: 1 / 1048576, KiB: 1 / 1024, MiB: 1, GiB: 1024 }[m[2]] : NaN; };

// Samples `docker stats` every 15 s. Returns { summary(fromMs, toMs), stop() }; summary is
// { container: { samples, cpuCoresAvg, cpuCoresMax, memMiBMax } } over the samples in the window.
function sampleStats() {
  const rows = {};
  const tick = () => {
    const names = Object.keys(watchedContainers());
    if (!names.length) return;
    const r = spawnSync("docker", ["stats", "--no-stream", "--format", "{{json .}}", ...names], { encoding: "utf8" });
    for (const line of (r.stdout || "").split("\n").filter(Boolean)) {
      try {
        const j = JSON.parse(line);
        (rows[j.Name] ||= []).push({ ts: Date.now(), cpu: parseFloat(j.CPUPerc) / 100, mem: toMiB(j.MemUsage.split("/")[0]) });
      } catch { /* ignore a malformed sample */ }
    }
  };
  const timer = setInterval(tick, 15000);
  return {
    stop: () => clearInterval(timer),
    summary(fromMs = 0, toMs = Infinity) {
      const out = {};
      for (const [name, all] of Object.entries(rows)) {
        const xs = all.filter((x) => x.ts >= fromMs && x.ts < toMs);
        if (!xs.length) continue;
        out[name] = { samples: xs.length, cpuCoresAvg: +(xs.reduce((a, x) => a + x.cpu, 0) / xs.length).toFixed(2), cpuCoresMax: +Math.max(...xs.map((x) => x.cpu)).toFixed(2), memMiBMax: Math.round(Math.max(...xs.map((x) => x.mem))) };
      }
      return out;
    },
  };
}

async function run(profile, flags) {
  if (!["smoke", "full", "soak"].includes(profile)) throw new Error("profile must be smoke | full | soak");
  if (!fs.existsSync(COOKIES)) throw new Error("no cookies.json; run `seed` first");
  await restore();
  const pw = process.env.PAIRWISE_SAMPLE_RATE !== undefined ? `-pairwise${process.env.PAIRWISE_SAMPLE_RATE}` : "";
  const out = path.join(RESULTS, `${new Date().toISOString().replace(/[:.]/g, "-")}-${profile}${pw}`);
  fs.mkdirSync(out, { recursive: true });
  const withSync = !flags.includes("--no-sync") && profile !== "smoke";
  const { user: pgUser, db: pgDb } = pgEnv();
  sh("docker", ["exec", PG, "psql", "-U", pgUser, "-d", pgDb, "-qc", "SELECT pg_stat_statements_reset()"], { allowFail: true });
  const stats = sampleStats();
  const svcByName = watchedContainers();
  const svcOf = (n) => svcByName[n];
  let tWorkload = 0;
  const k6 = (name, script, env) =>
    new Promise((resolve) => {
      if (name === "workload") tWorkload = Date.now();
      const p = spawn("k6", ["run", "--quiet", ...k6Env({ COOKIES, OUT: path.join(out, `${name}.json`), PROFILE: profile, ...env }), path.join(__dirname, script)], { stdio: ["ignore", "inherit", "inherit"] });
      p.on("exit", (code) => resolve(code));
    });
  const procs = [];
  if (withSync) procs.push(k6("sync", "sync.js", { SYNC_USERS: process.env.SYNC_USERS || 200, SYNC_RATE: process.env.SYNC_RATE || 0.2 }));
  procs.push(k6("workload", "workload.js", {}));
  const codes = await Promise.all(procs);
  stats.stop();
  // OTLP metrics are exported every 60 s and scraped every 15 s: let the tail land before querying.
  await sleep(80000);

  // Server-side numbers per hold step (1x / 2x / 3x ...), cut from the same run by the step offsets k6 reported.
  const wl = JSON.parse(fs.readFileSync(path.join(out, "workload.json"), "utf8"));
  const perStep = {};
  for (const st of wl.steps.filter((x) => /^\d+x$|^smoke$/.test(x.name))) {
    const secs = Math.round((st.endMs - st.startMs) / 1000);
    perStep[st.name] = {
      passed: st.passed,
      containers: stats.summary(tWorkload + st.startMs, tWorkload + st.endMs),
      prometheus: promSnapshot(`${secs}s`, tWorkload + st.endMs + 30000), // +30 s: metrics arrive after the export interval
    };
  }
  fs.writeFileSync(path.join(out, "steps.json"), JSON.stringify(perStep, null, 2));
  fs.writeFileSync(path.join(out, "containers.json"), JSON.stringify(stats.summary(), null, 2));
  sh("docker", ["exec", PG, "psql", "-U", pgUser, "-d", pgDb, "-c", "SELECT calls, round(total_exec_time::numeric) AS total_ms, round(mean_exec_time::numeric,2) AS mean_ms, rows, left(query,140) AS q FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 15"], { allowFail: true, stdio: ["ignore", fs.openSync(path.join(out, "pg_stat_statements.txt"), "w"), "inherit"] });
  for (const [name, st] of Object.entries(perStep)) {
    const c = st.containers;
    // Sum a service's replicas (api runs several); per-container detail is in containers.json.
    const cpu = (svc) => {
      const xs = Object.entries(c).filter(([n]) => svcOf(n) === svc).map(([, v]) => v);
      if (!xs.length) return "-";
      const sum = (k) => +xs.reduce((a, x) => a + x[k], 0).toFixed(2);
      return `${sum("cpuCoresAvg")}/${sum("cpuCoresMax")} cores, ${sum("memMiBMax")} MiB${xs.length > 1 ? ` (x${xs.length})` : ""}`;
    };
    console.log(`${name.padEnd(6)} api ${cpu("api")} | worker ${cpu("worker")} | db ${cpu("postgres")} | bandit ${cpu("bandit")}`);
  }
  console.log(`\nresults: ${out}\nk6 exit codes${withSync ? " (sync, workload)" : ""}: ${codes.join(",")}  (99 = an SLO threshold failed)`);
  // every k6 process must have passed (a failed sync must not hide behind a green workload)
  process.exitCode = codes.every((c) => c === 0) ? 0 : 1;
}

function auth() {
  sh("k6", ["run", ...k6Env({ RATE: process.env.AUTH_RATE || 5 }), path.join(__dirname, "auth.js")], { allowFail: true });
}

(async () => {
  const [cmd, a, ...rest] = process.argv.slice(2);
  try {
    if (cmd === "up") await up();
    else if (cmd === "seed") seed();
    else if (cmd === "cookies") { // rebuild cookies.json from existing seed-*.log files
      const all = {};
      for (const l of Object.keys(SEED)) Object.assign(all, parseCookies(path.join(RESULTS, `seed-${l}.log`)));
      fs.writeFileSync(COOKIES, JSON.stringify(all));
      console.log(`${Object.keys(all).length} users -> ${COOKIES}`);
    }
    else if (cmd === "run") await run(a || "smoke", rest);
    else if (cmd === "auth") auth();
    else if (cmd === "down") compose("down", "-v");
    else console.log(fs.readFileSync(__filename, "utf8").split("\n").slice(1, 14).join("\n"));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
})();
