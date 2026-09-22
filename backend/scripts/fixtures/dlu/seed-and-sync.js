/**
 * Seeds every student in students.json as a real Zenflow account (OTP login
 * via MailHog, no password), connects both DLU integrations against the fake
 * DLU server, then reports fake-dlu-server.ts request-count stats — the
 * "how many repetitions" baseline for issue #56 (per-section caching),
 * measured BEFORE that caching exists.
 *
 * Prereqs (all already running for this experiment):
 *  - dev stack up (postgres/redis/redis-ratelimit/mail) — compose.dev.yml
 *  - backend `start:dev` on :5000, .env.dev LMS_URL/PORTAL_API_URL pointed at
 *    the fake server, OTP rate limits raised (see .env.dev)
 *  - `node scripts/fake-dlu-server.ts` (ts-node) on :4100
 *  - the three ingestion watchers' @Cron temporarily set to EVERY_MINUTE
 *
 * Run: node seed-and-sync.js [--limit N]
 */
"use strict";
const fs = require("fs");
const path = require("path");

const API = "http://localhost:5000/api/v1";
const MAILHOG = "http://localhost:8025";
const FAKE_DLU = "http://localhost:4100";
const CONCURRENCY = 8;

const students = JSON.parse(fs.readFileSync(path.join(__dirname, "students.json"), "utf8"));
const limitArg = process.argv.indexOf("--limit");
const LIMIT = limitArg !== -1 ? Number(process.argv[limitArg + 1]) : students.length;
const targets = students.slice(0, LIMIT);

function emailFor(student) {
  return `${student.StudentID.toLowerCase()}@fixtures.test`;
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Poll MailHog for the OTP email and extract the 6-digit code. */
async function fetchOtp(email, { retries = 20, delayMs = 500 } = {}) {
  for (let i = 0; i < retries; i++) {
    const res = await fetch(`${MAILHOG}/api/v2/search?kind=to&query=${encodeURIComponent(email)}`);
    const json = await res.json();
    if (json.total > 0) {
      const body = json.items[0].Content.Body;
      const decoded = body
        .replace(/=\r?\n/g, "")
        .replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
      const match = decoded.match(/\b\d{6}\b/);
      if (match) return match[0];
    }
    await sleep(delayMs);
  }
  throw new Error(`no OTP email arrived for ${email}`);
}

async function seedOne(student) {
  const email = emailFor(student);

  const reqRes = await fetch(`${API}/auth/otp/request`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!reqRes.ok) throw new Error(`otp/request ${reqRes.status} for ${email}`);

  const otp = await fetchOtp(email);

  const verifyRes = await fetch(`${API}/auth/otp/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, otp }),
  });
  if (!verifyRes.ok) throw new Error(`otp/verify ${verifyRes.status} for ${email}`);
  const cookie = verifyRes.headers.get("set-cookie");
  if (!cookie) throw new Error(`no session cookie for ${email}`);
  const sessionCookie = cookie.split(";")[0];

  for (const [provider, username, password] of [
    ["LMS", student.lmsUsername, student.lmsPassword],
    ["PORTAL", student.portalUsername, student.portalPassword],
  ]) {
    const res = await fetch(`${API}/integrations`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: sessionCookie },
      body: JSON.stringify({ provider, username, password }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`connect ${provider} ${res.status} for ${email}: ${text}`);
    }
  }

  return email;
}

/** Simple bounded-concurrency pool. */
async function runPool(items, worker, concurrency) {
  let idx = 0;
  let ok = 0;
  let failed = 0;
  const errors = [];
  async function next() {
    while (idx < items.length) {
      const i = idx++;
      try {
        await worker(items[i]);
        ok++;
      } catch (err) {
        failed++;
        errors.push(`${items[i].StudentID}: ${err.message}`);
      }
      if ((ok + failed) % 10 === 0) {
        console.log(`  progress: ${ok + failed}/${items.length} (${ok} ok, ${failed} failed)`);
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, next));
  return { ok, failed, errors };
}

async function main() {
  console.log(`Seeding ${targets.length} students (concurrency ${CONCURRENCY})...`);
  const t0 = Date.now();
  const result = await runPool(targets, seedOne, CONCURRENCY);
  const seedSeconds = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`Seeded in ${seedSeconds}s: ${result.ok} ok, ${result.failed} failed.`);
  if (result.errors.length) {
    console.log("Errors (first 10):", result.errors.slice(0, 10));
  }

  // Zero the fake server's counters — everything after this point is purely
  // the every-minute crons, not the connect-time credential checks.
  await fetch(`${FAKE_DLU}/_/reset`, { method: "POST" });
  console.log("\nReset fake-dlu-server stats. Now observing cron repetition...");
  console.log(`(${targets.length} users connected; watchers fire every minute)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
