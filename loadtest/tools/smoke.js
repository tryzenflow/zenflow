#!/usr/bin/env node
// Smoke test of the Nest <-> Python integration BEFORE any timing (first time they run together).
//   node loadtest/tools/smoke.js <A|B|C> [--shadow]
// C (python mode): task, series, infeasible (409 + retry with each policy), kill the bandit container ->
// degraded fallback (schedulingDegraded, 503 when no slot), breaker, restart -> recovery.
// --shadow: recreate the API in SCHEDULER_PLACEMENT_MODE=shadow, place tasks, report mismatch log lines.
// The stack must already be up (orchestrate.js seed <V> leaves it stopped; use `docker compose ... up -d`).
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const path = require("node:path");
const fs = require("node:fs");
const execFileP = promisify(execFile);
const BASE = "http://localhost:5641/api/v1";
const MAIL = "http://localhost:8541";
const V = process.argv[2] || "C";
const SHADOW = process.argv.includes("--shadow");
const proj = `zflt-${V.toLowerCase()}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = { variant: V, steps: [] };
const step = (name, data) => { out.steps.push({ name, ...data }); console.log(name, JSON.stringify(data)); };

async function login(email) {
  const before = (await (await fetch(`${MAIL}/api/v2/search?kind=to&query=${encodeURIComponent(email)}`)).json()).items.length;
  const rq = await fetch(`${BASE}/auth/otp/request`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
  if (rq.status !== 200) throw new Error("otp request " + rq.status);
  for (let i = 0; i < 50; i++) {
    const items = (await (await fetch(`${MAIL}/api/v2/search?kind=to&query=${encodeURIComponent(email)}`)).json()).items;
    if (items.length > before) {
      const body = items[0].Content.Body.replace(/=\r?\n/g, "");
      const otp = body.match(/>\s*(\d{6})\s*</)[1];
      const vr = await fetch(`${BASE}/auth/otp/verify`, { method: "POST", headers: { "content-type": "application/json", "x-timezone": "Asia/Ho_Chi_Minh" }, body: JSON.stringify({ email, otp }) });
      return (vr.headers.getSetCookie() || []).map((c) => c.split(";")[0]).join("; ");
    }
    await sleep(200);
  }
  throw new Error("no mail");
}
const api = (cookie) => async (method, p, body) => {
  const r = await fetch(`${BASE}${p}`, { method, headers: { "content-type": "application/json", cookie }, body: body ? JSON.stringify(body) : undefined });
  let j = null;
  try { j = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: j };
};
const brief = (r) => ({ status: r.status, msg: r.body && r.body.message, code: r.body && (r.body.code || (r.body.data && r.body.data.code)), degraded: !!(r.body && r.body.data && (r.body.data.schedulingDegraded || (Array.isArray(r.body.data) ? r.body.data[0] && r.body.data[0].schedulingDegraded : false))) });
const psql = async (sql) => (await execFileP("docker", ["exec", `${proj}-postgres-1`, "psql", "-U", "admin", "-d", "zenflow-test", "-At", "-c", sql])).stdout.trim();
const iso = (ms) => new Date(ms).toISOString();
const logs = async () => { const r = await execFileP("docker", ["logs", `${proj}-api-1`], { maxBuffer: 64 << 20 }); return r.stdout + r.stderr; };

(async () => {
  const email = `smoke-${V.toLowerCase()}-${Date.now()}@example.com`;
  const A = api(await login(email));
  // integration bug #1 workaround: give the smoke user a 168-entry matrix (cold-start [] is rejected by Python with 422)
  if (!process.argv.includes("--cold")) await psql(`UPDATE "User" SET "preferenceMatrix" = (SELECT array_agg(round((sin(((g % 24) - 6) / 24.0 * 2 * pi()) * 2)::numeric, 3)::float8 ORDER BY g) FROM generate_series(0,167) g) WHERE email = '${email}'`);
  const now = Date.now();
  const task = (extra = {}) => ({ type: "TASK", title: "smoke task", durationMinutes: 60, deadline: iso(now + 10 * 86400000), reminders: [], ...extra });
  const post = (b) => A("POST", "/sessions", b);

  let r = await post(task());
  step("task", { ...brief(r), sample: r.body && r.body.data && { id: r.body.data.id, start: r.body.data.scheduledStartTime, keys: Object.keys(r.body.data).slice(0, 30) } });
  r = await post(task({ title: "smoke series", sessionCount: 8, deadline: iso(now + 30 * 86400000) }));
  step("series8", { ...brief(r), n: Array.isArray(r.body && r.body.data) ? r.body.data.length : undefined });

  // infeasible: fixed 6 h blocker from now+30m, 2 h task due in 5 h
  const t0 = Math.ceil((now + 30 * 60000) / 900000) * 900000;
  const blk = await post({ type: "EXAM", title: "smoke blocker", durationMinutes: 360, scheduledStartTime: iso(t0), reminders: [] });
  step("blocker", brief(blk));
  const inf = { type: "TASK", title: "smoke infeasible", durationMinutes: 120, deadline: iso(now + 5 * 3600000), reminders: [] };
  r = await post(inf);
  step("infeasible_first", { ...brief(r), body: r.body });
  for (const p of ["ACCEPT_CONFLICTS", "ACCEPT_LATE_DEADLINE"]) {
    r = await post({ ...inf, infeasiblePolicy: p });
    step(`infeasible_${p}`, { ...brief(r), data: r.body && r.body.data && { late: r.body.data.late, conflict: r.body.data.conflict, displaced: r.body.data.displaced, start: r.body.data.scheduledStartTime } });
  }
  out.proposalsNormal = await psql(`select "placementSource"||'/'||coalesce("degradedReason",'-'), count(*) from "SlotProposal" group by 1`);
  step("slotproposals_normal", { rows: out.proposalsNormal });

  if (V === "C" && !SHADOW) {
    await execFileP("docker", ["stop", "-t", "1", `${proj}-bandit-1`]);
    step("bandit_stopped", {});
    for (let i = 0; i < 7; i++) {
      r = await post(task({ title: `degraded ${i}` }));
      step(`degraded_task_${i}`, brief(r));
    }
    r = await post(inf);
    step("degraded_infeasible", { ...brief(r), body: r.body });
    r = await post(task({ title: "deg series", sessionCount: 5, deadline: iso(now + 20 * 86400000) }));
    step("degraded_series", brief(r));
    r = await post({ ...inf, infeasiblePolicy: "ACCEPT_CONFLICTS" });
    step("degraded_infeasible_with_policy", brief(r));
    await execFileP("docker", ["start", `${proj}-bandit-1`]);
    for (let i = 0; i < 60; i++) { try { if ((await fetch("http://localhost:8641/health")).status === 200) break; } catch { /* wait */ } await sleep(1000); }
    step("bandit_restarted", {});
    const rec = [];
    const t = Date.now();
    for (let i = 0; i < 12; i++) {
      r = await post(task({ title: `recovery ${i}` }));
      rec.push({ atSec: +((Date.now() - t) / 1000).toFixed(1), ...brief(r) });
      if (!brief(r).degraded) break;
      await sleep(3000);
    }
    step("recovery", { attempts: rec });
    out.proposalsAfter = await psql(`select "placementSource"||'/'||coalesce("degradedReason",'-'), count(*) from "SlotProposal" group by 1 order by 1`);
    step("slotproposals_after", { rows: out.proposalsAfter });
  }

  if (SHADOW) {
    let n = 0;
    for (let i = 0; i < 20; i++) {
      r = await post(task({ title: `shadow ${i}`, deadline: iso(now + (3 + (i % 10) * 3) * 86400000) }));
      if (r.status < 300) n++;
    }
    await sleep(3000); // shadow compare is fire-and-forget
    const l = await logs();
    const lines = l.split("\n").filter((x) => /shadow/i.test(x));
    step("shadow", { placed: n, mismatchLines: lines.filter((x) => x.includes("shadow mismatch")).length, failedLines: lines.filter((x) => x.includes("failed")).length, sample: lines.slice(0, 6).map((x) => x.slice(0, 300)) });
  }
  fs.mkdirSync(path.join(__dirname, "..", "results"), { recursive: true });
  fs.writeFileSync(path.join(__dirname, "..", "results", `smoke-${V}${SHADOW ? "-shadow" : ""}.json`), JSON.stringify(out, null, 1));
})().catch((e) => { console.error("SMOKE FAILED", e); process.exit(1); });
