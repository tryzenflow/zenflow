// Placement-path workload. One user per VU (users seeded by seed.js).
// Env: BASE MAIL LEVEL VUS MODE(constant|ramp|arrival|steady) DURATION VARIANT OUT COOKIES
//      OPS(mix|task|series|infeasible) TASK_DAYS SERIES_N SERIES_DAYS RAMP("rate:dur,rate:dur,...") NUSERS
//
// Iteration shapes (closed loop, no think time unless MODE=arrival):
//   mix        list_week, post_task(deadline TASK_DAYS), patch_move, patch_resize, post_series(SERIES_N sittings,
//              deadline SERIES_DAYS), delete task + series        (headline workload)
//   task       list_week, post_task, patch_move, patch_resize, delete           (scan-window scenarios)
//   series     post_series, delete                                              (series-size scenarios)
//   infeasible blocker (fixed, untimed) -> post_task with a deadline that cannot be met:
//              infeas_first (AFTER: 409), infeas_conflicts / infeas_late (retry with infeasiblePolicy;
//              BEFORE has no such field, so the strict pipe answers 400). Reported separately, never headline.
// Cleanup deletes are timed under `delete` and never mixed into placement numbers.
import http from "k6/http";
import { Trend, Counter } from "k6/metrics";
import { BASE, VU_JAR, emailFor, login, headers, localDayStartMs, iso } from "./lib.js";

const LEVEL = __ENV.LEVEL || "medium";
const VUS = parseInt(__ENV.VUS || "1", 10);
const NUSERS = parseInt(__ENV.NUSERS || "50", 10);
const MODE = __ENV.MODE || "constant";
const DURATION = __ENV.DURATION || "60s";
const VARIANT = __ENV.VARIANT || "unknown";
const OPSMODE = __ENV.OPS || "mix";
const TASK_DAYS = parseInt(__ENV.TASK_DAYS || "30", 10);
const SERIES_N = parseInt(__ENV.SERIES_N || "8", 10);
const SERIES_DAYS = parseInt(__ENV.SERIES_DAYS || "30", 10);
const RAMP = (__ENV.RAMP || "2:15s,4:15s,6:15s,8:15s").split(",").map((x) => {
  const [r, d] = x.split(":");
  return { target: parseInt(r, 10), duration: d };
});

let COOKIES = {};
try {
  COOKIES = JSON.parse(open(__ENV.COOKIES));
} catch (e) {
  /* fall back to OTP login in setup() */
}

const OPS = ["list_week", "post_task", "patch_move", "patch_resize", "post_series", "delete", "blocker", "infeas_first", "infeas_conflicts", "infeas_late"];
const CLASSES = ["ok", "s409", "s503", "s4xx", "s5xx", "s0"];
const PHASES = ["dayload", "http", "scan", "predict", "db_apply"];
const T = {}, C = {}, PH = {};
for (const o of OPS) {
  T[o] = new Trend(`op_${o}`, true);
  for (const c of CLASSES) C[`${o}_${c}`] = new Counter(`c_${o}_${c}`);
}
for (const p of PHASES) PH[p] = new Trend(`ph_${p}`, true);
const LATE = new Counter("resp_late_true");
const DISPLACED = new Counter("resp_displaced_nonempty");
const CONFLICT = new Counter("resp_conflict_true");
const DEGRADED = new Counter("resp_degraded_true");

const executors = {
  constant: { executor: "constant-vus", vus: VUS, duration: DURATION },
  steady: { executor: "constant-vus", vus: VUS, duration: DURATION },
  ramp: { executor: "ramping-vus", startVUs: 0, stages: [{ duration: "30s", target: VUS }, { duration: "30s", target: VUS }], gracefulRampDown: "10s" },
  // open model: iterations/s is the driver, so latency growth shows up as dropped iterations, not as a slower client
  arrival: { executor: "ramping-arrival-rate", startRate: 1, timeUnit: "1s", preAllocatedVUs: Math.max(20, VUS), maxVUs: Math.max(60, VUS * 2), stages: RAMP, gracefulStop: "15s" },
}[MODE];

export const options = {
  scenarios: { main: executors },
  setupTimeout: "10m",
  summaryTrendStats: ["min", "avg", "med", "p(90)", "p(95)", "p(99)", "max"],
};

export function setup() {
  const n = MODE === "arrival" ? NUSERS : Math.min(VUS, NUSERS);
  const cookies = [];
  for (let i = 1; i <= n; i++) {
    const email = emailFor(LEVEL, i);
    let ck = COOKIES[email];
    if (ck) {
      const me = http.get(`${BASE}/auth/me`, { headers: headers(ck), jar: VU_JAR, tags: { name: "setup_me" } });
      if (me.status !== 200) ck = null;
    }
    cookies.push(ck || login(email));
  }
  return { cookies };
}

function cls(status) {
  if (status === 200 || status === 201 || status === 204) return "ok";
  if (status === 409) return "s409";
  if (status === 503) return "s503";
  if (status === 0) return "s0";
  if (status >= 500) return "s5xx";
  return "s4xx";
}

function timed(op, res, phases) {
  T[op].add(res.timings.duration);
  C[`${op}_${cls(res.status)}`].add(1);
  if (phases) {
    const st = res.headers["Server-Timing"];
    if (st) {
      for (const part of st.split(",")) {
        const m = part.trim().match(/^([a-z_]+);dur=([\d.]+)/);
        if (m && PH[m[1]]) PH[m[1]].add(parseFloat(m[2]));
      }
    }
  }
}

function inspect(res) {
  if (res.status !== 200 && res.status !== 201) return;
  let d;
  try { d = res.json("data"); } catch (e) { return; }
  const list = Array.isArray(d) ? d : d && d.sessions ? d.sessions : [d];
  for (const s of list) {
    if (!s) continue;
    if (s.late === true) LATE.add(1);
    if (s.conflict === true) CONFLICT.add(1);
    if (s.schedulingDegraded === true) DEGRADED.add(1);
    if (Array.isArray(s.displaced) && s.displaced.length) DISPLACED.add(1);
  }
  if (d && d.schedulingDegraded === true) DEGRADED.add(1);
  if (d && Array.isArray(d.displaced) && d.displaced.length) DISPLACED.add(1);
}

const idOf = (r) => (r.status === 200 || r.status === 201 ? r.json("data.id") : null);

export default function (data) {
  const h = { headers: headers(data.cookies[(__VU - 1) % data.cookies.length]), jar: VU_JAR };
  const it = __ITER;
  const now = Date.now();
  const del = (path) => timed("delete", http.del(`${BASE}${path}`, null, { ...h, tags: { name: "delete" } }));

  if (OPSMODE === "infeasible") return infeasible(h, now, del);

  if (OPSMODE === "mix" || OPSMODE === "task") {
    const weekDate = iso(localDayStartMs(1 + 7 * (it % 4), now)).slice(0, 10);
    timed("list_week", http.get(`${BASE}/sessions?view=week&date=${weekDate}`, { ...h, tags: { name: "list_week" } }));
    const deadline = iso(now + TASK_DAYS * 86400000);
    let r = http.post(`${BASE}/sessions`, JSON.stringify({ type: "TASK", title: `lt task ${it}`, durationMinutes: 60, deadline, reminders: [] }), { ...h, tags: { name: "post_task" } });
    timed("post_task", r, true);
    inspect(r);
    const taskId = idOf(r);
    if (taskId) {
      // move to 21:00 local on a day inside the scan window (may collide with a fixed block: the API decides)
      const target = localDayStartMs(1 + (it % Math.min(5, TASK_DAYS)), now) + 21 * 3600000;
      r = http.patch(`${BASE}/sessions/${taskId}`, JSON.stringify({ scheduledStartTime: iso(target) }), { ...h, tags: { name: "patch_move" } });
      timed("patch_move", r, true);
      inspect(r);
      r = http.patch(`${BASE}/sessions/${taskId}`, JSON.stringify({ durationMinutes: 90 }), { ...h, tags: { name: "patch_resize" } });
      timed("patch_resize", r, true);
      inspect(r);
    }
    let seriesId = null;
    if (OPSMODE === "mix") seriesId = postSeries(h, now, it);
    if (taskId) del(`/sessions/${taskId}`);
    if (seriesId) del(`/sessions/series/${seriesId}`);
  } else if (OPSMODE === "series") {
    const seriesId = postSeries(h, now, it);
    if (seriesId) del(`/sessions/series/${seriesId}`);
  }
}

function postSeries(h, now, it) {
  const r = http.post(`${BASE}/sessions`, JSON.stringify({ type: "TASK", title: `lt series ${it}`, durationMinutes: 60, sessionCount: SERIES_N, deadline: iso(now + SERIES_DAYS * 86400000), reminders: [] }), { ...h, tags: { name: "post_series" } });
  timed("post_series", r, true);
  inspect(r);
  if (r.status !== 200 && r.status !== 201) return null;
  const d = r.json("data");
  const first = Array.isArray(d) ? d[0] : d.sessions ? d.sessions[0] : d;
  return first && first.seriesId;
}

function infeasible(h, now, del) {
  // a fixed blocker covering [now+30m, now+6.5h]; the task needs 2 h before a deadline at now+5h
  const t0 = Math.ceil((now + 30 * 60000) / 900000) * 900000;
  let r = http.post(`${BASE}/sessions`, JSON.stringify({ type: "EXAM", title: "lt blocker", durationMinutes: 360, scheduledStartTime: iso(t0), reminders: [] }), { ...h, tags: { name: "blocker" } });
  timed("blocker", r);
  const blockerId = idOf(r);
  const body = { type: "TASK", title: "lt infeasible", durationMinutes: 120, deadline: iso(now + 5 * 3600000), reminders: [] };
  const created = [];
  r = http.post(`${BASE}/sessions`, JSON.stringify(body), { ...h, tags: { name: "infeas_first" } });
  timed("infeas_first", r, true);
  inspect(r);
  if (idOf(r)) created.push(idOf(r));
  for (const [op, policy] of [["infeas_conflicts", "ACCEPT_CONFLICTS"], ["infeas_late", "ACCEPT_LATE_DEADLINE"]]) {
    r = http.post(`${BASE}/sessions`, JSON.stringify({ ...body, infeasiblePolicy: policy }), { ...h, tags: { name: op } });
    timed(op, r, true);
    inspect(r);
    const id = idOf(r);
    if (id) created.push(id);
  }
  for (const id of created) del(`/sessions/${id}`);
  if (blockerId) del(`/sessions/${blockerId}`);
}

export function handleSummary(data) {
  const m = data.metrics;
  const v = (name, key) => (m[name] && m[name].values ? m[name].values[key] : undefined);
  const dur = (data.state.testRunDurationMs || 0) / 1000;
  const ops = {};
  for (const o of OPS) {
    const cnt = {};
    let total = 0;
    for (const c of CLASSES) {
      cnt[c] = v(`c_${o}_${c}`, "count") || 0;
      total += cnt[c];
    }
    if (!total) continue;
    ops[o] = {
      count: total, status: cnt, errors: total - cnt.ok, errorRate: (total - cnt.ok) / total,
      p50: v(`op_${o}`, "med"), p90: v(`op_${o}`, "p(90)"), p95: v(`op_${o}`, "p(95)"), p99: v(`op_${o}`, "p(99)"), avg: v(`op_${o}`, "avg"), max: v(`op_${o}`, "max"),
    };
  }
  const phases = {};
  for (const p of PHASES) {
    if (m[`ph_${p}`] && v(`ph_${p}`, "avg") !== undefined) phases[p] = { avg: v(`ph_${p}`, "avg"), p50: v(`ph_${p}`, "med"), p95: v(`ph_${p}`, "p(95)"), max: v(`ph_${p}`, "max") };
  }
  const out = {
    variant: VARIANT, mode: MODE, ops_mode: OPSMODE, level: LEVEL, vus: VUS, taskDays: TASK_DAYS, seriesN: SERIES_N, seriesDays: SERIES_DAYS, durationSec: dur,
    http: { reqs: v("http_reqs", "count"), rps: v("http_reqs", "rate"), p50: v("http_req_duration", "med"), p95: v("http_req_duration", "p(95)"), p99: v("http_req_duration", "p(99)"), max: v("http_req_duration", "max") },
    iterations: v("iterations", "count"), iterationsPerSec: v("iterations", "rate"), droppedIterations: v("dropped_iterations", "count") || 0,
    vusMax: v("vus_max", "max"),
    responseFlags: { late: v("resp_late_true", "count") || 0, displacedNonEmpty: v("resp_displaced_nonempty", "count") || 0, conflict: v("resp_conflict_true", "count") || 0, degraded: v("resp_degraded_true", "count") || 0 },
    phases, ops,
  };
  return { [__ENV.OUT || "summary.json"]: JSON.stringify(out, null, 2) };
}
