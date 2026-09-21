// Seeds users lt-<level>-1..USERS with the realistic fixed schedule for LEVEL (light|medium|heavy)
// through the real API (weekly LECTURE rrule series, EXAM and ASSIGNMENT one-offs; see lib.js fixedPlan).
// Prints one `COOKIE\t<email>\t<cookie>` line per user (the orchestrator captures them via
// --console-output so run.js can skip 50 OTP logins per scenario).
// k6 run -e BASE=... -e MAIL=... -e LEVEL=heavy -e USERS=50 seed.js
import http from "k6/http";
import { check } from "k6";
import exec from "k6/execution";
import { BASE, emailFor, login, headers, fixedPlan } from "./lib.js";

const LEVEL = __ENV.LEVEL || "medium";
const USERS = parseInt(__ENV.USERS || "50", 10);
const PAR = parseInt(__ENV.PAR || "10", 10);

export const options = {
  scenarios: { seed: { executor: "shared-iterations", vus: PAR, iterations: USERS, maxDuration: "40m" } },
  summaryTrendStats: ["avg", "p(95)", "max"],
};

export default function () {
  const idx = exec.scenario.iterationInTest + 1;
  const email = emailFor(LEVEL, idx);
  const cookie = login(email);
  console.log(`COOKIE\t${email}\t${cookie}`);
  const now = Date.now();
  for (const body of fixedPlan(LEVEL, now)) {
    const r = http.post(`${BASE}/sessions`, JSON.stringify(body), { headers: headers(cookie), tags: { name: "seed_post" } });
    check(r, { "seed 200/201": (x) => x.status === 200 || x.status === 201 });
    if (r.status !== 200 && r.status !== 201) console.log(`SEEDFAIL\t${email}\t${r.status}\t${String(r.body).slice(0, 160)}`);
  }
}
