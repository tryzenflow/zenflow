// W9: OTP login burst (launch day: many users sign in at once).
//   MODE=throughput  staging with the raised OTP limits: measures request/verify latency at RATE logins/s.
//   MODE=limits      staging started with compose.staging.shipped-otp.yml: from ONE IP expect 429s once the
//                    shipped limits trip (5/min per IP on request); checks the limiter works and stays fast.
//   k6 run -e BASE=... -e MAIL=http://localhost:8025 -e MAIL_KIND=mailpit -e MODE=throughput -e RATE=5 auth.js
import http from "k6/http";
import { Trend, Counter } from "k6/metrics";
import { sleep } from "k6";
import exec from "k6/execution";
import { BASE, MAIL, MAIL_KIND, JSON_H, TZ } from "../scripts/lib.js";

const MODE = __ENV.MODE || "throughput";
const RATE = parseFloat(__ENV.RATE || "5");
const DURATION = __ENV.DURATION || "2m";

const REQ = new Trend("otp_request", true);
const VER = new Trend("otp_verify", true);
const ST = {};
for (const op of ["request", "verify"]) for (const k of ["200", "429", "other"]) ST[`${op}_${k}`] = new Counter(`otp_${op}_${k}`);
const status = (op, code) => ST[`${op}_${code === 200 ? "200" : code === 429 ? "429" : "other"}`].add(1);

export const options = {
  scenarios: { burst: { executor: "constant-arrival-rate", rate: RATE, timeUnit: "1s", duration: DURATION, preAllocatedVUs: 20, maxVUs: 300 } },
  thresholds: MODE === "throughput" ? { otp_verify: ["p(95)<500"], otp_request: ["p(95)<1500"] } : {},
  summaryTrendStats: ["avg", "med", "p(95)", "p(99)", "max"],
};

function codeFor(email) {
  for (let i = 0; i < 50; i++) {
    let body = "";
    if (MAIL_KIND === "mailpit") {
      const l = http.get(`${MAIL}/api/v1/search?query=${encodeURIComponent("to:" + email)}&limit=1`, { tags: { name: "mail" } }).json("messages") || [];
      // plain-text part only: the one 6-digit number in it is the code (the HTML has colour codes like #333333)
      if (l.length) body = http.get(`${MAIL}/api/v1/message/${l[0].ID}`, { tags: { name: "mail" } }).json("Text") || "";
    } else {
      const items = http.get(`${MAIL}/api/v2/search?kind=to&query=${encodeURIComponent(email)}`, { tags: { name: "mail" } }).json("items") || [];
      if (items.length) body = items[0].Content.Body;
    }
    const m = body.match(/\b(\d{6})\b/);
    if (m) return m[1];
    sleep(0.2);
  }
  return null;
}

export default function () {
  const email = `lt-auth-${exec.scenario.iterationInTest}@example.com`;
  const rq = http.post(`${BASE}/auth/otp/request`, JSON.stringify({ email }), { headers: JSON_H, jar: new http.CookieJar(), tags: { name: "otp_request" } });
  REQ.add(rq.timings.duration);
  status("request", rq.status);
  if (rq.status !== 200) return;
  const otp = codeFor(email);
  if (!otp) return;
  const vr = http.post(`${BASE}/auth/otp/verify`, JSON.stringify({ email, otp }), { headers: { ...JSON_H, "X-Timezone": TZ }, jar: new http.CookieJar(), tags: { name: "otp_verify" } });
  VER.add(vr.timings.duration);
  status("verify", vr.status);
}
