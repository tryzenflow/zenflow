#!/usr/bin/env node
/**
 * Maestro E2E Suite Runner (issue #79)
 * Orchestrates the full P0/P1 run because Maestro flows cannot:
 *   - call the backend test endpoints (reset/seed), or
 *   - fetch the OTP from MailHog mid-suite.
 *
 * Usage: node scripts/run-suite.js [smoke|extended]   (default: smoke)
 *
 * Sequence:
 *   1. POST /test/reset + clear MailHog      (reset-test-data.js)
 *   2. seed deterministic tasks via API      (seed-task.js × 3 — one OTP
 *     login shared through E2E_SESSION_FILE, BEFORE the device asks for
 *     its code: a later seed login would replace/consume the device's
 *     pending OTP and each request counts against the per-email limit)
 *   3. clear MailHog again                   (drop the seed OTP emails so
 *     get-otp.js's exactly-one-message check sees only the device's)
 *   4. maestro login-request.yaml            (email → send OTP)
 *   5. poll MailHog for the OTP              (get-otp.js)
 *   6. maestro login-verify.yaml + suite     (ONE session: enter OTP, then
 *                                             the flows — E2E_OTP/E2E_TODAY/
 *                                             E2E_NEXT_WEEK passed as env)
 *
 * Env (all optional — sane local defaults):
 *   MAESTRO_APP_ID, E2E_RUN_ID, E2E_EMAIL, E2E_TODAY (yyyy-MM-dd),
 *   E2E_NEXT_WEEK (yyyy-MM-dd, today+7 — header day-chip navigation),
 *   EXPO_PUBLIC_API_URL (device-side API URL, baked into the app),
 *   E2E_API_URL (host-side API URL for reset/seed/OTP-login calls —
 *     defaults to EXPO_PUBLIC_API_URL; set to localhost form when the
 *     device reaches the backend via 10.0.2.2 on Android emulators),
 *   MAILHOG_URL
 *
 * Run from anywhere: paths resolve from this file; maestro runs with
 * cwd=mobile/ so maestro-report.xml lands next to package.json
 * (matching the CI artifact upload paths).
 */

const { spawnSync, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SCRIPTS_DIR = __dirname;
const MOBILE_DIR = path.resolve(SCRIPTS_DIR, "..", "..");
const FLOWS_DIR = path.resolve(SCRIPTS_DIR, "..", "flows");

function pad(n) {
  return String(n).padStart(2, "0");
}
function dateKey(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function atNoon(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0);
}
function addDays(d, n) {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}

const suite = process.argv[2] || "smoke";
if (!["smoke", "extended"].includes(suite)) {
  console.error(`[run-suite] unknown suite "${suite}" — use smoke|extended`);
  process.exit(1);
}

const now = new Date();
const RUN_ID =
  process.env.E2E_RUN_ID ||
  `local-${dateKey(now).replaceAll("-", "")}-${pad(now.getHours())}${pad(now.getMinutes())}`;
const EMAIL = process.env.E2E_EMAIL || `mobile-e2e+${RUN_ID}@example.test`;
const TODAY = process.env.E2E_TODAY || dateKey(now);
const NEXT_WEEK = process.env.E2E_NEXT_WEEK || dateKey(addDays(now, 7));
const APP_ID = process.env.MAESTRO_APP_ID || "com.zenflow.app";
const API_URL =
  process.env.EXPO_PUBLIC_API_URL || "http://localhost:5000/api/v1";
const MAILHOG_URL = process.env.MAILHOG_URL || "http://localhost:8025";
// Shared seed session: seed-task.js logs in once, caches the cookie here,
// and the later seeds reuse it (one OTP request total instead of three).
const SESSION_FILE = path.join(
  os.tmpdir(),
  `zenflow-e2e-seed-${RUN_ID}.cookie`,
);

const env = {
  ...process.env,
  MAESTRO_APP_ID: APP_ID,
  E2E_RUN_ID: RUN_ID,
  E2E_EMAIL: EMAIL,
  E2E_TODAY: TODAY,
  E2E_NEXT_WEEK: NEXT_WEEK,
  E2E_SESSION_FILE: SESSION_FILE,
  EXPO_PUBLIC_API_URL: API_URL,
  MAILHOG_URL,
};

console.log("[run-suite] config:", {
  suite,
  RUN_ID,
  EMAIL,
  TODAY,
  NEXT_WEEK,
  APP_ID,
  API_URL,
  MAILHOG_URL,
});

function runNode(script, args) {
  const r = spawnSync(process.execPath, [path.join(SCRIPTS_DIR, script), ...args], {
    env,
    stdio: "inherit",
  });
  if (r.status !== 0) {
    console.error(`[run-suite] ${script} failed (exit ${r.status})`);
    process.exit(r.status ?? 1);
  }
}

function runMaestro(flowFiles) {
  const flowPaths = flowFiles.map(f => path.join(FLOWS_DIR, f));
  console.log(`[run-suite] maestro test ${flowFiles.join(" ")}`);
  const r = spawnSync(
    "maestro",
    ["test", "--format", "junit", "--output", "maestro-report.xml", ...flowPaths],
    { env, stdio: "inherit", cwd: MOBILE_DIR },
  );
  if (r.status !== 0) {
    console.error(`[run-suite] ${flowFiles.join(" ")} FAILED — see maestro-report.xml`);
    process.exit(r.status ?? 1);
  }
}

// 1. Clean backend + MailHog, then seed BEFORE the device asks for its OTP
async function main() {
  runNode("reset-test-data.js", []);
  // A stale cached seed session (same E2E_RUN_ID rerun) points at a user
  // the reset just truncated — always start the seed login from scratch.
  fs.rmSync(SESSION_FILE, { force: true });

  // 2. Seed deterministic tasks (local noon => same calendar day in any tz).
  //    Seeding must finish before login-request: a seed OTP login after the
  //    device's request would REPLACE its pending code (and each verify
  //    consumes it), and requests count against a 3-per-email window.
  const noonToday = atNoon(now);
  const noonNextWeek = atNoon(addDays(now, 7));
  runNode("seed-task.js", [
    `E2E Seeded ${RUN_ID}`,
    "TASK",
    addDays(noonToday, 2).toISOString(), // deadline
    "60",
    "1", // sessionCount
    noonToday.toISOString(), // scheduledStartTime
  ]);
  runNode("seed-task.js", [
    "E2E This Week",
    "TASK",
    addDays(noonToday, 2).toISOString(),
    "60",
    "1",
    noonToday.toISOString(),
  ]);
  runNode("seed-task.js", [
    "E2E Next Week",
    "TASK",
    addDays(noonNextWeek, 2).toISOString(),
    "60",
    "1",
    noonNextWeek.toISOString(),
  ]);

  // 3. Drop the seed OTP emails so get-otp.js's exactly-one-message check
  //    (stale-OTP guard) sees only the device's code, and fail fast if the
  //    box is not actually empty.
  {
    const cleared = await fetch(`${MAILHOG_URL}/api/v1/messages`, {
      method: "DELETE",
    });
    if (!cleared.ok) {
      console.error(
        `[run-suite] MailHog clear failed (${cleared.status}) — aborting`,
      );
      process.exit(1);
    }
    const m = await (
      await fetch(`${MAILHOG_URL}/api/v2/messages?limit=1`)
    ).json();
    if ((m.total ?? (m.items || []).length) > 0) {
      console.error("[run-suite] MailHog not empty after reset — aborting");
      process.exit(1);
    }
  }

  // 4. Request the OTP. Own Maestro invocation: the code does not exist
  //    until MailHog has it (step 5), so it cannot be entered yet. The app
  //    stays on the OTP screen — no launchApp in any later flow.
  runMaestro(["login-request.yaml"]);

  // 5. Fetch the OTP MailHog received for our email
  const otpOut = execFileSync(
    process.execPath,
    [path.join(SCRIPTS_DIR, "get-otp.js"), EMAIL],
    {
      env,
      encoding: "utf8",
    },
  );
  const otp = otpOut
    .split("\n")
    .map((l) => l.trim())
    .find((l) => /^\d{6}$/.test(l));
  if (!otp) {
    console.error("[run-suite] could not parse OTP from get-otp.js output");
    process.exit(1);
  }
  console.log("[run-suite] OTP retrieved");
  env.E2E_OTP = otp;

  // 6. Enter the OTP and run the suite in ONE Maestro session, so nothing
  //    restarts between verification and onboarding.
  runMaestro([
    "login-verify.yaml",
    suite === "extended" ? "extended.yaml" : "smoke.yaml",
  ]);

  console.log("[run-suite] SUITE PASSED — report: mobile/maestro-report.xml");
}

main().catch((err) => {
  console.error(`[run-suite] ${err.message}`);
  process.exit(1);
});
