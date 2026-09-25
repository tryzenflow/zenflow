#!/usr/bin/env node
// Aggregates results/<V>/p<N>/<tag>.json (+ .status.json) into results/summary.json and writes the
// self-contained loadtest/report.html (inline CSS/JS/SVG only). Only VALID final runs are aggregated;
// invalid attempts are listed from results/invalid.log. Medians and min/max across passes.
//   node loadtest/tools/report.js
// Optional hand-written fragments (not committed, folded into the HTML): results/verdict.html, results/bugs.html
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const R = path.join(ROOT, "results");
const { SCENARIOS } = require("./orchestrate.js");
const V = { A: "BEFORE (f821194)", B: "AFTER-legacy", C: "AFTER-python" };
const rd = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
const rdText = (f) => { try { return fs.readFileSync(f, "utf8"); } catch { return ""; } };

function extract(run, st) {
  const ops = run.ops || {};
  const total = Object.values(ops).reduce((s, o) => s + o.count, 0);
  const isInf = run.ops_mode === "infeasible";
  const errOps = Object.entries(ops).filter(([k]) => k !== "blocker" && !(isInf && k.startsWith("infeas")));
  const errs = errOps.reduce((s, [, o]) => s + o.errors, 0);
  const cnt = errOps.reduce((s, [, o]) => s + o.count, 0);
  const m = {
    p50: run.http.p50, p95: run.http.p95, p99: run.http.p99, rps: total / run.durationSec, ipsec: run.iterationsPerSec,
    errRate: cnt ? (100 * errs) / cnt : 0, dropped: run.droppedIterations || 0, degraded: run.responseFlags.degraded,
  };
  for (const o of ["list_week", "post_task", "patch_move", "patch_resize", "post_series", "infeas_first", "infeas_conflicts", "infeas_late"]) {
    if (ops[o]) { m[`${o}_p50`] = ops[o].p50; m[`${o}_p95`] = ops[o].p95; m[`${o}_p99`] = ops[o].p99; m[`${o}_n`] = ops[o].count; for (const [c, n] of Object.entries(ops[o].status)) m[`${o}_st_${c}`] = n; }
  }
  if (st && st.pgTotal) { m.pgPerReq = st.pgTotal.calls / total; m.pgMsPerReq = st.pgTotal.total_ms / total; }
  if (st && st.docker) for (const [svc, d] of Object.entries(st.docker)) if (["api", "bandit", "postgres", "redis"].includes(svc)) { m[`${svc}_cpu`] = d.cpuAvgPct; m[`${svc}_cpumax`] = d.cpuMaxPct; m[`${svc}_mem`] = d.memMaxMiB; }
  for (const [p, d] of Object.entries(run.phases || {})) m[`ph_${p}`] = d.avg;
  return m;
}
const agg = (vals) => { const v = vals.filter((x) => typeof x === "number" && isFinite(x)).sort((a, b) => a - b); if (!v.length) return null; const mid = v.length >> 1; return { med: v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2, min: v[0], max: v[v.length - 1], n: v.length }; };

const cells = {};
const passesSeen = {};
for (const Vk of Object.keys(V)) {
  cells[Vk] = {};
  const vdir = path.join(R, Vk);
  if (!fs.existsSync(vdir)) continue;
  for (const p of fs.readdirSync(vdir).filter((d) => /^p\d+$/.test(d))) {
    for (const f of fs.readdirSync(path.join(vdir, p)).filter((x) => x.endsWith(".json") && !x.includes(".status.") && !x.includes("INVALID") && !x.startsWith("warmup"))) {
      const tag = f.replace(/\.json$/, "");
      const run = rd(path.join(vdir, p, f));
      const st = rd(path.join(vdir, p, `${tag}.status.json`));
      if (!run || (st && !st.valid)) continue;
      const m = extract(run, st);
      const c = (cells[Vk][tag] ||= { runs: [], passes: [] });
      c.runs.push(m); c.passes.push(p);
    }
  }
  for (const c of Object.values(cells[Vk])) {
    c.stat = {};
    for (const k of new Set(c.runs.flatMap((r) => Object.keys(r)))) c.stat[k] = agg(c.runs.map((r) => r[k]));
  }
}
const invalid = rdText(path.join(R, "invalid.log")).split("\n").filter(Boolean).map((l) => JSON.parse(l));
const smoke = rd(path.join(R, "smoke-C.json"));
fs.writeFileSync(path.join(R, "summary.json"), JSON.stringify({ cells, invalid }, null, 1));

// ---------- HTML ----------
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const S = (Vk, tag, k) => cells[Vk][tag] && cells[Vk][tag].stat[k];
const f = (x, d = 0) => (x == null ? "n/a" : x.toFixed(d));
const cell = (a, d = 0) => (a ? `<b>${f(a.med, d)}</b> <span class="mm">${f(a.min, d)}&ndash;${f(a.max, d)}</span>` : "n/a");
const nOf = (Vk, tag) => (cells[Vk][tag] ? cells[Vk][tag].runs.length : 0);
const COL = { A: "var(--c1)", B: "var(--c2)", C: "var(--c3)" };

function table(rowDefs, metricKey, d = 0) {
  let h = `<table><thead><tr><th>scenario</th>${Object.keys(V).map((k) => `<th>${k} ${esc(V[k])}</th>`).join("")}</tr></thead><tbody>`;
  for (const [label, tag] of rowDefs) h += `<tr><td>${esc(label)}</td>${Object.keys(V).map((k) => `<td>${cell(S(k, tag, metricKey), d)}${nOf(k, tag) ? ` <span class="n">n=${nOf(k, tag)}</span>` : ""}</td>`).join("")}</tr>`;
  return h + "</tbody></table>";
}
// grouped bar chart with min/max whiskers. groups = [[label, tag]]
function chart(id, title, unit, groups, metricKey) {
  const W = 720, H = 300, L = 56, B = 46, T = 18, Rr = 12;
  const vals = [];
  for (const [, tag] of groups) for (const k of Object.keys(V)) { const a = S(k, tag, metricKey); if (a) vals.push(a.max); }
  if (!vals.length) return `<p class="muted">${esc(title)}: no data</p>`;
  const top = Math.max(...vals) * 1.1 || 1;
  const gw = (W - L - Rr) / groups.length, bw = Math.min(34, (gw - 14) / 3);
  const y = (v) => T + (H - T - B) * (1 - v / top);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}" class="chart">`;
  for (let i = 0; i <= 4; i++) { const v = (top * i) / 4; s += `<line x1="${L}" x2="${W - Rr}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${L - 6}" y="${y(v) + 4}" class="ax" text-anchor="end">${v >= 100 ? v.toFixed(0) : v.toFixed(1)}</text>`; }
  groups.forEach(([label, tag], gi) => {
    const x0 = L + gi * gw + gw / 2 - (bw * 3 + 8) / 2;
    Object.keys(V).forEach((k, ki) => {
      const a = S(k, tag, metricKey); if (!a) return;
      const x = x0 + ki * (bw + 4);
      s += `<g><title>${esc(V[k])} ${esc(label)}: median ${f(a.med, 1)} ${unit} (min ${f(a.min, 1)}, max ${f(a.max, 1)}, n=${a.n})</title>`;
      s += `<rect x="${x}" y="${y(a.med)}" width="${bw}" height="${Math.max(1, y(0) - y(a.med))}" rx="3" fill="${COL[k]}"/>`;
      s += `<line x1="${x + bw / 2}" x2="${x + bw / 2}" y1="${y(a.min)}" y2="${y(a.max)}" class="wh"/><line x1="${x + bw / 2 - 4}" x2="${x + bw / 2 + 4}" y1="${y(a.max)}" y2="${y(a.max)}" class="wh"/><line x1="${x + bw / 2 - 4}" x2="${x + bw / 2 + 4}" y1="${y(a.min)}" y2="${y(a.min)}" class="wh"/></g>`;
    });
    s += `<text x="${L + gi * gw + gw / 2}" y="${H - B + 16}" class="ax" text-anchor="middle">${esc(label)}</text>`;
  });
  s += `<text x="12" y="${T + 4}" class="ax">${unit}</text></svg>`;
  return `<figure><figcaption>${esc(title)}</figcaption>${s}</figure>`;
}
const legend = `<div class="legend">${Object.keys(V).map((k) => `<span><i style="background:${COL[k]}"></i>${k}: ${esc(V[k])}</span>`).join("")}<span class="muted">bar = median, whisker = min/max over passes</span></div>`;

const headMed = [1, 10, 25, 50].map((v) => [`${v} VUs`, `mix_medium_v${v}`]);
const lvl10 = ["light", "medium", "heavy"].map((l) => [l, `mix_${l}_v10`]);
const lvl50 = ["light", "medium", "heavy"].map((l) => [l, `mix_${l}_v50`]);
const scan = [7, 30, 60].map((d) => [`${d} d`, `scan_${d}d`]);
const ser = [[3, 30], [8, 30], [12, 30], [20, 60]].map(([n, d]) => [`${n} x / ${d} d`, `series_${n}x_${d}d`]);
const allHead = [...headMed, ...["light", "heavy"].flatMap((l) => [10, 50].map((v) => [`${l} ${v} VUs`, `mix_${l}_v${v}`]))];

function dockerTable() {
  const rows = [...headMed, ["heavy 50 VUs", "mix_heavy_v50"]];
  let h = `<table><thead><tr><th>scenario</th><th>variant</th><th>API cpu% avg (max) of 200</th><th>API mem max MiB</th><th>bandit cpu% avg</th><th>bandit mem MiB</th><th>postgres cpu% avg</th><th>pg stmts/req</th></tr></thead><tbody>`;
  for (const [label, tag] of rows) for (const k of Object.keys(V)) if (cells[k][tag]) h += `<tr><td>${esc(label)}</td><td>${k}</td><td>${cell(S(k, tag, "api_cpu"))} (${f(S(k, tag, "api_cpumax") && S(k, tag, "api_cpumax").med)})</td><td>${cell(S(k, tag, "api_mem"))}</td><td>${cell(S(k, tag, "bandit_cpu"))}</td><td>${cell(S(k, tag, "bandit_mem"))}</td><td>${cell(S(k, tag, "postgres_cpu"))}</td><td>${cell(S(k, tag, "pgPerReq"), 1)}</td></tr>`;
  return h + "</tbody></table>";
}
function phaseTable() {
  const tags = ["mix_medium_v10", "scan_60d", "series_20x_60d"];
  const phs = ["dayload", "http", "scan", "predict", "db_apply"];
  let h = `<table><thead><tr><th>scenario</th><th>variant</th>${phs.map((p) => `<th>${p} ms (mean)</th>`).join("")}</tr></thead><tbody>`;
  for (const t of tags) for (const k of ["B", "C"]) if (cells[k][t]) h += `<tr><td>${t}</td><td>${k}</td>${phs.map((p) => `<td>${cell(S(k, t, "ph_" + p), 1)}</td>`).join("")}</tr>`;
  return h + "</tbody></table><p class=muted>Server-Timing phases are summed per request over all placement calls in the request, then averaged over placement requests. Variant A has no BENCH_TIMING support. <code>scan</code> in C is the Python-reported scan; in B the TS scan is not instrumented (blank).</p>";
}
function infTable() {
  const ops = [["infeas_first", "first attempt (no policy)"], ["infeas_conflicts", "retry ACCEPT_CONFLICTS"], ["infeas_late", "retry ACCEPT_LATE_DEADLINE"]];
  let h = `<table><thead><tr><th>request</th><th>variant</th><th>p50 ms</th><th>p95 ms</th><th>status mix (median counts per pass)</th></tr></thead><tbody>`;
  for (const [o, label] of ops) for (const k of Object.keys(V)) { const t = "infeasible_medium_v10"; if (!cells[k][t]) continue; const st = ["ok", "s409", "s503", "s4xx", "s5xx"].map((c) => [c, S(k, t, `${o}_st_${c}`)]).filter(([, a]) => a && a.med).map(([c, a]) => `${c}=${f(a.med)}`).join(" "); h += `<tr><td>${label}</td><td>${k}</td><td>${cell(S(k, t, o + "_p50"))}</td><td>${cell(S(k, t, o + "_p95"))}</td><td>${st}</td></tr>`; }
  return h + "</tbody></table>";
}
function arrivalTable() {
  let h = `<table><thead><tr><th>variant</th><th>iterations/s achieved</th><th>dropped iterations</th><th>http p95 ms</th><th>error %</th></tr></thead><tbody>`;
  for (const k of Object.keys(V)) if (cells[k].arrival_medium) h += `<tr><td>${k}</td><td>${cell(S(k, "arrival_medium", "ipsec"), 2)}</td><td>${cell(S(k, "arrival_medium", "dropped"))}</td><td>${cell(S(k, "arrival_medium", "p95"))}</td><td>${cell(S(k, "arrival_medium", "errRate"), 2)}</td></tr>`;
  return h + "</tbody></table>";
}
function steadyTable() {
  let h = `<table><thead><tr><th>variant</th><th>p50</th><th>p95</th><th>p99</th><th>req/s</th><th>error %</th><th>API mem max MiB</th></tr></thead><tbody>`;
  for (const k of Object.keys(V)) if (cells[k].steady_medium_v10) { const t = "steady_medium_v10"; h += `<tr><td>${k}</td>${["p50", "p95", "p99", "rps"].map((m) => `<td>${cell(S(k, t, m), m === "rps" ? 1 : 0)}</td>`).join("")}<td>${cell(S(k, t, "errRate"), 2)}</td><td>${cell(S(k, t, "api_mem"))}</td></tr>`; }
  return h + "</tbody></table>";
}
const spec = fs.existsSync(path.join(R, "setup.html")) ? rdText(path.join(R, "setup.html")) : "";
const verdict = rdText(path.join(R, "verdict.html")) || "<p>(verdict not written)</p>";
const bugs = rdText(path.join(R, "bugs.html"));
const invRows = invalid.length ? `<table><thead><tr><th>variant</th><th>pass</th><th>scenario</th><th>attempt</th><th>reason</th></tr></thead><tbody>${invalid.map((i) => `<tr><td>${i.variant}</td><td>${i.pass}</td><td>${esc(i.tag)}</td><td>${i.attempt}</td><td>${esc((i.reasons || []).join("; "))}</td></tr>`).join("")}</tbody></table>` : "<p>None recorded.</p>";
const missing = [];
for (const k of Object.keys(V)) for (const sc of SCENARIOS) { const n = nOf(k, sc.tag); const want = sc.steadyOnlyPass1 ? 1 : 3; if (n < want) missing.push(`${k}/${sc.tag}: ${n}/${want} valid passes`); }

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Zenflow load test report</title>
<style>
:root{--bg:#fcfcfb;--fg:#0b0b0b;--fg2:#52514e;--line:#e3e2dd;--card:#f5f4f1;--c1:#2a78d6;--c2:#eb6834;--c3:#1baf7a}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#1a1a19;--fg:#fff;--fg2:#c3c2b7;--line:#383835;--card:#232322;--c1:#3987e5;--c2:#d95926;--c3:#199e70}}
:root[data-theme=dark]{--bg:#1a1a19;--fg:#fff;--fg2:#c3c2b7;--line:#383835;--card:#232322;--c1:#3987e5;--c2:#d95926;--c3:#199e70}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif}main{max-width:1000px;margin:0 auto;padding:24px 16px 80px}
h1{font-size:26px}h2{margin-top:40px;border-bottom:1px solid var(--line);padding-bottom:6px}h3{margin-top:24px}
table{border-collapse:collapse;width:100%;font-size:13px;margin:8px 0 16px;display:block;overflow-x:auto}th,td{border-bottom:1px solid var(--line);padding:5px 8px;text-align:left;white-space:nowrap}th{color:var(--fg2);font-weight:600}
.mm,.n,.muted{color:var(--fg2)}.mm{font-size:12px}.n{font-size:11px}
.chart{width:100%;height:auto;max-width:720px}.grid{stroke:var(--line);stroke-width:1}.ax{fill:var(--fg2);font-size:11px}.wh{stroke:var(--fg);stroke-width:1.5}
figure{margin:12px 0}figcaption{font-weight:600;margin-bottom:4px}
.legend{display:flex;flex-wrap:wrap;gap:14px;font-size:13px;margin:8px 0}.legend i{display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:6px;vertical-align:-1px}
.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:4px 16px;margin:12px 0}code{background:var(--card);padding:0 4px;border-radius:3px}
button{background:var(--card);color:var(--fg);border:1px solid var(--line);border-radius:6px;padding:4px 10px;cursor:pointer;float:right}
</style></head><body><main>
<button onclick="var r=document.documentElement;r.dataset.theme=(r.dataset.theme==='dark'||(!r.dataset.theme&&matchMedia('(prefers-color-scheme:dark)').matches))?'light':'dark'">Toggle theme</button>
<h1>Zenflow scheduler load test: BEFORE vs AFTER-legacy vs AFTER-python</h1>
<p class="muted">Generated ${new Date().toISOString()}. Numbers are medians over up to 3 passes (min&ndash;max in grey). All services in Docker with fixed CPU/memory limits; k6 on the host.</p>
${legend}
<h2>Verdict</h2><div class="card">${verdict}</div>
<h2>Setup and limits</h2>${spec}
<h2>Headline: standard mix, medium fixed load</h2>
<p>Each iteration: list week, create task (30-day scan), move, resize, create 8-sitting series (30 d), delete both. Latency is all requests of the iteration (http_req_duration).</p>
${chart("h1", "p95 latency by VUs (medium load)", "ms", headMed, "p95")}
${chart("h2", "p50 latency by VUs (medium load)", "ms", headMed, "p50")}
${chart("h3", "Throughput by VUs (medium load)", "req/s", headMed, "rps")}
<h3>All headline cells: p50 / p95 / p99 (ms), req/s, errors</h3>
<p>p50</p>${table(allHead, "p50")}<p>p95</p>${table(allHead, "p95")}<p>p99</p>${table(allHead, "p99")}<p>throughput (req/s)</p>${table(allHead, "rps", 1)}<p>error rate (%)</p>${table(allHead, "errRate", 2)}
<h2>Effect of fixed load (light ~8, medium ~25, heavy ~60 fixed per week)</h2>
${chart("l1", "p95 at 10 VUs", "ms", lvl10, "p95")}${chart("l2", "p95 at 50 VUs", "ms", lvl50, "p95")}
<h2>Scan window (single task only, 10 VUs, medium load)</h2>
${chart("s1", "post_task p95 by deadline horizon", "ms", scan, "post_task_p95")}${table(scan, "post_task_p50")}
<h2>Series size (series only, 10 VUs, medium load)</h2>
${chart("r1", "post_series p95 by sittings / horizon", "ms", ser, "post_series_p95")}<p>p50</p>${table(ser, "post_series_p50")}<p>error rate (%)</p>${table(ser, "errRate", 2)}
<h2>Infeasible path (separate, not in headline numbers)</h2>
<p>A fixed blocker covers the window; a 2 h task is due in 5 h. AFTER answers 409 SCHEDULE_INFEASIBLE, then accepts a policy. BEFORE has no such path/field: the strict pipe answers 400 to the policy retries, and the first attempt behaves as recorded below. Displacement was not exercised (needs movable flexible tasks inside the window).</p>${infTable()}
<h2>Ramping arrival rate (open model), medium load</h2>${arrivalTable()}
<h2>5-minute steady state (pass 1 only, single sample)</h2>${steadyTable()}
<h2>Resource use (docker stats) and DB statements per request</h2>${dockerTable()}
<h2>Per-phase timings (Server-Timing, BENCH_TIMING=1)</h2>${phaseTable()}
<h2>Integration findings</h2>${bugs || "<p>(none written)</p>"}
<h2>Invalid runs and data gaps</h2><h3>Invalidated attempts (discarded and rerun)</h3>${invRows}
<h3>Cells with fewer valid passes than planned</h3>${missing.length ? `<ul>${missing.map((m) => `<li>${esc(m)}</li>`).join("")}</ul>` : "<p>None.</p>"}
</main></body></html>`;
fs.writeFileSync(path.join(ROOT, "report.html"), html);
console.log(`report.html ${(html.length / 1024).toFixed(0)} KB; invalid attempts: ${invalid.length}; gaps: ${missing.length}`);
