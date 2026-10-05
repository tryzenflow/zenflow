// SLO table (issue #77) -> k6 thresholds, plus the load profiles. Draft numbers: finalise after the 1x baseline.
// Latency SLOs are p95 in ms, keyed by the op metric name (`op_<name>`, see workload.js).

// 1x = launch cohort peak. Defaults: 5k registered users, ~250 concurrent, one action per ~10 s each.
export const CONCURRENT = parseInt(__ENV.CONCURRENT || "250", 10);
export const THINK_S = parseFloat(__ENV.THINK_S || "10");
export const BASE_RATE = CONCURRENT / THINK_S; // iterations (user actions) per second at 1x

export const SLO = {
  // op: [p95 at 1x, p95 at 2-3x]
  list_week: [300, 600],
  list_month: [500, 1000],
  post_task: [800, 1500],
  post_series: [1500, 3000],
  patch_move: [400, 800],
  patch_resize: [400, 800],
  delete: [400, 800],
  infeas_first: [200, 400], // 409 SCHEDULE_INFEASIBLE comes back fast; it is the expected answer
  settings_me: [200, 400],
  settings_patch: [200, 400],
  settings_matrix: [200, 400],
};
export const AVAILABILITY = [0.001, 0.005]; // max share of status 0 / >=500 (409 is expected, not an error)

// One run, several load steps. `full` = warm-up, then 1x / 2x / 3x holds joined by short ramps, then ramp-down;
// MAX_MULT=6 keeps stepping up to find the breaking point. `soak` = a single 1x hold (SOAK_S, default 15 min).
// Only hold steps (named "<n>x") are checked against the SLOs; warm-up, ramps and ramp-down are not.
export const HOLD_S = parseInt(__ENV.HOLD_S || "240", 10);
export const RAMP_S = parseInt(__ENV.RAMP_S || "60", 10);
export const MAX_MULT = parseInt(__ENV.MAX_MULT || "3", 10);

export function planFor(profile) {
  const at = (m) => Math.round(BASE_RATE * m);
  let segs;
  if (profile === "smoke") {
    segs = [{ name: "ramp", target: 2, s: 30 }, { name: "smoke", target: 2, s: 30 }];
  } else if (profile === "full" || profile === "soak") {
    segs = [{ name: "warmup", target: at(1), s: 120 }];
    const top = profile === "soak" ? 1 : MAX_MULT;
    for (let m = 1; m <= top; m++) {
      if (m > 1) segs.push({ name: "ramp", target: at(m), s: RAMP_S });
      segs.push({ name: `${m}x`, target: at(m), s: profile === "soak" ? parseInt(__ENV.SOAK_S || "900", 10) : HOLD_S });
    }
    segs.push({ name: "rampdown", target: 0, s: 60 });
  } else {
    throw new Error(`unknown PROFILE ${profile} (smoke|full|soak)`);
  }
  let t = 0;
  const steps = segs.map((g) => { const st = { name: g.name, startMs: t * 1000, endMs: (t + g.s) * 1000, rate: g.target }; t += g.s; return st; });
  return { stages: segs.map((g) => ({ target: g.target, duration: `${g.s}s` })), steps, totalSeconds: t };
}

export const isHold = (name) => /^\d+x$/.test(name) || name === "smoke";

export function thresholdsFor(profile) {
  const t = {};
  for (const st of planFor(profile).steps) {
    if (!isHold(st.name)) continue;
    const tier = st.name === "1x" || st.name === "smoke" ? 0 : 1;
    t[`unavailable{step:${st.name}}`] = [`rate<${AVAILABILITY[tier]}`];
    for (const [op, p95] of Object.entries(SLO)) t[`op_${op}{step:${st.name}}`] = [`p(95)<${p95[tier]}`];
  }
  return t;
}
