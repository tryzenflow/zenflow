// Staging workload: open-model mix of what the web/mobile app does (issue #77).
// Each iteration = one user action on a random seeded user. Weights follow the plan (W1-W8).
//
//   k6 run -e BASE=http://localhost/api/v1 -e COOKIES=/abs/cookies.json -e PROFILE=full \
//          -e OUT=/abs/summary.json workload.js
//
// Env: BASE COOKIES PROFILE(smoke|full|soak) OUT CONCURRENT THINK_S HOLD_S RAMP_S MAX_MULT SOAK_S SERIES_N TASK_DAYS
import http from "k6/http";
import { Trend, Rate, Counter } from "k6/metrics";
import { BASE, VU_JAR, headers, localDayStartMs, iso } from "../scripts/lib.js";
import exec from "k6/execution";
import { thresholdsFor, planFor, isHold, SLO } from "./slo.js";

const PROFILE = __ENV.PROFILE || "smoke";
const PLAN = planFor(PROFILE);
const SERIES_N = parseInt(__ENV.SERIES_N || "8", 10);
const TASK_DAYS = parseInt(__ENV.TASK_DAYS || "30", 10);

const COOKIES = Object.values(JSON.parse(open(__ENV.COOKIES)));
if (!COOKIES.length) throw new Error("COOKIES file has no users; run `orchestrate.js seed`");

const OPS = Object.keys(SLO).concat(["infeas_conflicts", "infeas_late", "blocker"]);
const T = {};
for (const o of OPS) T[o] = new Trend(`op_${o}`, true);
const UNAVAILABLE = new Rate("unavailable");
const UNEXPECTED = new Counter("unexpected_status"); // 4xx/5xx other than the expected 409 on the infeasible path
const DEGRADED = new Counter("resp_degraded_true");
const NOOP = new Counter("noop_no_target");
const STEP_ITERS = new Counter("step_iterations"); // iterations actually started in each step (dropped ones never start)

export const options = {
  scenarios: {
    users: {
      executor: "ramping-arrival-rate",
      startRate: 1,
      timeUnit: "1s",
      preAllocatedVUs: 100,
      maxVUs: 3000,
      stages: PLAN.stages,
      gracefulStop: "30s",
    },
  },
  thresholds: thresholdsFor(PROFILE),
  summaryTrendStats: ["min", "avg", "med", "p(90)", "p(95)", "p(99)", "max"],
};

// Cumulative weights (%). W9 (auth) and W10 (sync) run as separate k6 processes.
const MIX = [
  [45, week],
  [60, month],
  [75, postTask],
  [80, postSeries],
  [88, edit],
  [92, remove],
  [94, infeasible],
  [100, settings],
];

// Per-VU memory of what this VU created, so edit/delete act on real ids (VU state persists across iterations).
const mine = [];

// Name of the plan step the test is in right now ("1x", "2x", "ramp", ...), set once per iteration.
let STEP = "warmup";
function currentStep() {
  const ms = exec.instance.currentTestRunDuration;
  const st = PLAN.steps.find((x) => ms >= x.startMs && ms < x.endMs);
  return st ? st.name : "rampdown";
}

function record(op, res, expected409 = false) {
  T[op].add(res.timings.duration, { step: STEP });
  const s = res.status;
  UNAVAILABLE.add(s === 0 || s >= 500, { step: STEP });
  if (!(s === 200 || s === 201 || s === 204 || (expected409 && s === 409))) UNEXPECTED.add(1, { op, step: STEP });
  return s === 200 || s === 201;
}

function dataOf(r) {
  try { return r.json("data"); } catch (e) { return null; }
}

function flagDegraded(d) {
  const list = Array.isArray(d) ? d : d && d.sessions ? d.sessions : [d];
  if ((d && d.schedulingDegraded === true) || list.some((s) => s && s.schedulingDegraded === true)) DEGRADED.add(1);
}

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const reqOpts = (h, name) => ({ headers: h, jar: VU_JAR, tags: { name } });

function dateParam(now) {
  // the app mostly looks at the current week/month; sometimes browses a few weeks around it
  const off = Math.random() < 0.6 ? 0 : Math.floor(Math.random() * 9) - 4;
  return iso(localDayStartMs(7 * off, now)).slice(0, 10);
}

function week(h, now) {
  record("list_week", http.get(`${BASE}/sessions?view=week&date=${dateParam(now)}`, reqOpts(h, "list_week")));
}
function month(h, now) {
  record("list_month", http.get(`${BASE}/sessions?view=month&date=${dateParam(now)}`, reqOpts(h, "list_month")));
}

function postTask(h, now, cookie) {
  const body = { type: "TASK", title: `lt task ${__VU}.${__ITER}`, durationMinutes: pick([30, 60, 90, 120]), deadline: iso(now + TASK_DAYS * 86400000), reminders: [] };
  const r = http.post(`${BASE}/sessions`, JSON.stringify(body), reqOpts(h, "post_task"));
  const ok = record("post_task", r);
  const d = ok ? dataOf(r) : null;
  if (d) {
    flagDegraded(d);
    if (d.id) mine.push({ id: d.id, cookie });
    // the app re-fetches the calendar after a schedule
    week(h, now);
  }
}

function postSeries(h, now, cookie) {
  const body = { type: "TASK", title: `lt series ${__VU}.${__ITER}`, durationMinutes: 60, sessionCount: SERIES_N, deadline: iso(now + 30 * 86400000), reminders: [] };
  const r = http.post(`${BASE}/sessions`, JSON.stringify(body), reqOpts(h, "post_series"));
  const ok = record("post_series", r);
  const d = ok ? dataOf(r) : null;
  if (d) {
    flagDegraded(d);
    const first = Array.isArray(d) ? d[0] : d.sessions ? d.sessions[0] : d;
    if (first && first.seriesId) mine.push({ seriesId: first.seriesId, cookie });
    month(h, now);
  }
}

function edit(h, now, cookie) {
  const t = mine.find((m) => m.id);
  if (!t) return postTask(h, now, cookie); // nothing to edit yet: schedule first, as a user would
  const hh = headers(t.cookie);
  if (Math.random() < 0.5) {
    const target = localDayStartMs(1 + Math.floor(Math.random() * 5), now) + 21 * 3600000;
    const r = http.patch(`${BASE}/sessions/${t.id}`, JSON.stringify({ scheduledStartTime: iso(target) }), reqOpts(hh, "patch_move"));
    record("patch_move", r);
  } else {
    const r = http.patch(`${BASE}/sessions/${t.id}`, JSON.stringify({ durationMinutes: pick([45, 90, 120]) }), reqOpts(hh, "patch_resize"));
    record("patch_resize", r);
  }
}

function remove(h, now, cookie) {
  const i = mine.length ? Math.floor(Math.random() * mine.length) : -1;
  if (i === -1) { NOOP.add(1); return; }
  const [t] = mine.splice(i, 1);
  const path = t.seriesId ? `/sessions/series/${t.seriesId}` : `/sessions/${t.id}`;
  record("delete", http.del(`${BASE}${path}`, null, reqOpts(headers(t.cookie), "delete")));
}

function infeasible(h, now) {
  // fixed blocker [now+30m, now+6.5h]; a 2 h task due at now+5h cannot fit -> 409, then accept-conflicts
  const t0 = Math.ceil((now + 30 * 60000) / 900000) * 900000;
  const b = http.post(`${BASE}/sessions`, JSON.stringify({ type: "EXAM", title: "lt blocker", durationMinutes: 360, scheduledStartTime: iso(t0), reminders: [] }), reqOpts(h, "blocker"));
  record("blocker", b);
  const task = { type: "TASK", title: "lt infeasible", durationMinutes: 120, deadline: iso(now + 5 * 3600000), reminders: [] };
  const first = http.post(`${BASE}/sessions`, JSON.stringify(task), reqOpts(h, "infeas_first"));
  record("infeas_first", first, true);
  const created = [];
  if (first.status === 200 || first.status === 201) { const d = dataOf(first); if (d && d.id) created.push(d.id); }
  const retry = http.post(`${BASE}/sessions`, JSON.stringify({ ...task, infeasiblePolicy: "ACCEPT_CONFLICTS" }), reqOpts(h, "infeas_conflicts"));
  record("infeas_conflicts", retry);
  if (retry.status === 200 || retry.status === 201) { const d = dataOf(retry); if (d && d.id) created.push(d.id); }
  // clean up so the blocker does not accumulate on the user's calendar
  for (const id of created) http.del(`${BASE}/sessions/${id}`, null, reqOpts(h, "cleanup"));
  if (b.status === 200 || b.status === 201) { const d = dataOf(b); if (d && d.id) http.del(`${BASE}/sessions/${d.id}`, null, reqOpts(h, "cleanup")); }
}

function settings(h) {
  record("settings_me", http.get(`${BASE}/users/me`, reqOpts(h, "settings_me")));
  record("settings_patch", http.patch(`${BASE}/users/update/basic-info`, JSON.stringify({ defaultReminderMinutes: pick([5, 10, 15, 30]) }), reqOpts(h, "settings_patch")));
  record("settings_matrix", http.get(`${BASE}/users/me/preference-matrix`, reqOpts(h, "settings_matrix")));
}

export default function () {
  STEP = currentStep();
  STEP_ITERS.add(1, { step: STEP });
  const cookie = pick(COOKIES);
  const h = headers(cookie);
  const now = Date.now();
  const roll = Math.random() * 100;
  for (const [cum, fn] of MIX) {
    if (roll < cum) return fn(h, now, cookie);
  }
}

export function handleSummary(data) {
  const m = data.metrics;
  const v = (name, key) => (m[name] && m[name].values ? m[name].values[key] : undefined);
  const trend = (name) => ({ p50: v(name, "med"), p90: v(name, "p(90)"), p95: v(name, "p(95)"), p99: v(name, "p(99)"), max: v(name, "max"), avg: v(name, "avg"), count: v(name, "count") });
  const ops = {};
  for (const o of OPS) if (m[`op_${o}`]) ops[o] = trend(`op_${o}`);
  // per hold step: latency per op (from the step-tagged sub-metrics) and pass/fail of every threshold
  const steps = PLAN.steps.map((st) => {
    const out = { name: st.name, startMs: st.startMs, endMs: st.endMs, targetItersPerSec: st.rate };
    if (!isHold(st.name)) return out;
    out.ops = {};
    out.failed = [];
    for (const o of OPS) if (m[`op_${o}{step:${st.name}}`]) out.ops[o] = trend(`op_${o}{step:${st.name}}`);
    out.unavailableRate = v(`unavailable{step:${st.name}}`, "rate");
    out.iterationsDelivered = v(`step_iterations{step:${st.name}}`, "count") || 0;
    out.iterationsPlanned = Math.round((st.rate * (st.endMs - st.startMs)) / 1000);
    out.unexpectedStatuses = v(`unexpected_status{step:${st.name}}`, "count") || 0;
    for (const [name, mm] of Object.entries(m)) if (name.endsWith(`{step:${st.name}}`) && mm.thresholds) for (const [t, r] of Object.entries(mm.thresholds)) if (!r.ok) out.failed.push(`${name} ${t}`);
    out.passed = out.failed.length === 0;
    return out;
  });
  const out = {
    profile: PROFILE, durationSec: (data.state.testRunDurationMs || 0) / 1000,
    http: { reqs: v("http_reqs", "count"), rps: v("http_reqs", "rate"), p95: v("http_req_duration", "p(95)"), p99: v("http_req_duration", "p(99)") },
    iterations: v("iterations", "count"), iterationsPerSec: v("iterations", "rate"), droppedIterations: v("dropped_iterations", "count") || 0, vusMax: v("vus_max", "max"),
    unexpectedStatus: v("unexpected_status", "count") || 0, degraded: v("resp_degraded_true", "count") || 0, noop: v("noop_no_target", "count") || 0,
    steps, ops,
  };
  const table = steps.filter((x) => x.ops).map((x) => `${x.name.padEnd(6)} ${x.passed ? "PASS" : "FAIL"}  load=${x.iterationsDelivered}/${x.iterationsPlanned}  unexpected=${x.unexpectedStatuses}  unavailable=${((x.unavailableRate || 0) * 100).toFixed(2)}%  ` + ["list_week", "list_month", "post_task", "post_series", "patch_move"].map((o) => `${o}=${x.ops[o] ? Math.round(x.ops[o].p95) : "-"}ms`).join(" ") + (x.failed.length ? `\n         failed: ${x.failed.join("; ")}` : "")).join("\n");
  return { [__ENV.OUT || "summary.json"]: JSON.stringify(out, null, 2), stdout: `\np95 per step (dropped iterations: ${out.droppedIterations}, unexpected statuses: ${out.unexpectedStatus})\n${table}\n` };
}
