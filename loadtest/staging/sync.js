// W10: background DLU sync load, run alongside workload.js. Connects fake DLU credentials for the first
// SYNC_USERS users (any username/password works against the fake server), then triggers
// POST /integrations/:provider/sync at SYNC_RATE per second (default 0.2: sparse, like the sequential cron watchers and rare manual syncs), alternating LMS / PORTAL.
// The staging API must have LMS_URL / PORTAL_API_URL pointing at fake-dlu (compose.staging.yml), never real DLU.
//
//   k6 run -e BASE=... -e COOKIES=/abs/cookies.json -e PROFILE=full sync.js
import http from "k6/http";
import { Trend, Rate } from "k6/metrics";
import { BASE, headers } from "../scripts/lib.js";
import { planFor } from "./slo.js";

const SYNC_USERS = parseInt(__ENV.SYNC_USERS || "200", 10);
const SYNC_RATE = parseFloat(__ENV.SYNC_RATE || "0.2");
// Spans the whole workload run (same PROFILE), plus the setup time before it starts.
const DURATION = `${planFor(__ENV.PROFILE || "full").totalSeconds}s`;

const COOKIES = Object.values(JSON.parse(open(__ENV.COOKIES))).slice(0, SYNC_USERS);
const SYNC = { LMS: new Trend("sync_lms", true), PORTAL: new Trend("sync_portal", true) };
const SYNC_FAIL = new Rate("sync_failed");

export const options = {
  scenarios: {
    // k6 wants an integer rate: 0.2/s is written as 1 per 5 s
    sync: { executor: "constant-arrival-rate", rate: SYNC_RATE < 1 ? 1 : Math.round(SYNC_RATE), timeUnit: SYNC_RATE < 1 ? `${Math.round(1 / SYNC_RATE)}s` : "1s", duration: DURATION, preAllocatedVUs: 20, maxVUs: 200 },
  },
  setupTimeout: "10m",
  summaryTrendStats: ["avg", "med", "p(95)", "p(99)", "max"],
};

export function setup() {
  for (const cookie of COOKIES) {
    for (const provider of ["LMS", "PORTAL"]) {
      const r = http.post(`${BASE}/integrations`, JSON.stringify({ provider, username: "20240001", password: "fake-password" }), { headers: headers(cookie), tags: { name: "integrations_connect" } });
      if (r.status !== 200 && r.status !== 201) throw new Error(`connect ${provider} -> ${r.status} ${String(r.body).slice(0, 200)} (is LMS_URL pointing at fake-dlu?)`);
    }
  }
}

export default function () {
  const cookie = COOKIES[Math.floor(Math.random() * COOKIES.length)];
  const provider = Math.random() < 0.5 ? "LMS" : "PORTAL";
  // a sync is synchronous and walks the upstream with INGESTION_REQUEST_DELAY_MS pauses, so it takes seconds
  const r = http.post(`${BASE}/integrations/${provider}/sync`, null, { headers: headers(cookie), timeout: "180s", tags: { name: `sync_${provider.toLowerCase()}` } });
  SYNC[provider].add(r.timings.duration);
  SYNC_FAIL.add(r.status !== 200 && r.status !== 201);
}

export function handleSummary(data) {
  const m = data.metrics;
  const v = (n, k) => (m[n] && m[n].values ? m[n].values[k] : undefined);
  const out = {
    syncs: v("iterations", "count"), failedRate: v("sync_failed", "rate"),
    lms: { p50: v("sync_lms", "med"), p95: v("sync_lms", "p(95)"), max: v("sync_lms", "max") },
    portal: { p50: v("sync_portal", "med"), p95: v("sync_portal", "p(95)"), max: v("sync_portal", "max") },
  };
  return { [__ENV.OUT || "sync-summary.json"]: JSON.stringify(out, null, 2) };
}
