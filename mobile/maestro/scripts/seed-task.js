#!/usr/bin/env node
/**
 * Seed Test Task Helper for Maestro E2E Tests
 * Creates a task via the backend API for edit/calendar flows
 * Usage: node scripts/seed-task.js <title> <type> <deadlineISO> <durationMinutes> <sessionCount> <scheduledStartISO>
 *
 * Types: TASK, DND, ASSIGNMENT, EXAM, LECTURE (backend SessionType enum).
 * scheduledStartISO is REQUIRED — it pins the session to a deterministic
 * calendar slot for any task a calendar flow asserts on, since seeded rows
 * bypass the placement engine, and the API rejects seeds without a start.
 *
 * Auth: OTP login once per session. Set E2E_SESSION_FILE to a writable path
 * and the first call stores the session cookie there for later calls to
 * reuse (run-suite.js seeds ×3 with ONE OTP request this way — a fresh
 * request per seed would replace the device's pending login code and blow
 * the 3-per-email rate limit). A cached cookie that the backend rejects
 * (e.g. after a reset) is re-logged-in once automatically.
 */

const fs = require("node:fs");

const API_URL = process.env.E2E_API_URL || process.env.EXPO_PUBLIC_API_URL || 'http://localhost:5000/api/v1';
const MAILHOG_URL = process.env.MAILHOG_URL || 'http://localhost:8025';
const EMAIL = process.env.E2E_EMAIL;
const SESSION_FILE = process.env.E2E_SESSION_FILE;

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function requestOtp(email) {
  const response = await fetch(`${API_URL}/auth/otp/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  const data = await response.json();
  if (!data.success) {
    throw new Error(`Failed to request OTP: ${data.message}`);
  }
  console.log('[seed-task] OTP requested for:', email);
}

function messageId(msg) {
  return msg.ID || JSON.stringify(msg.To) + (msg.Created || "");
}

async function knownIds(email) {
  const ids = new Set();
  try {
    const response = await fetch(`${MAILHOG_URL}/api/v2/messages?limit=50`);
    const data = await response.json();
    for (const msg of data.items || []) {
      const to = msg.To || [];
      if (to.some(t => t.Mailbox + '@' + t.Domain === email)) ids.add(messageId(msg));
    }
  } catch { /* polling loop below retries */ }
  return ids;
}

async function getOtpFromMailHog(email, timeoutMs = 60000, seenBefore = null) {
  // Snapshot the box BEFORE requesting: earlier messages for this email
  // (e.g. the device login OTP) must never be picked up. We wait for a
  // message ID we have not seen before. Pass the pre-request snapshot in;
  // when omitted we snapshot here (only safe if no request is in flight).
  const seen = seenBefore || (await knownIds(email));
  const startTime = Date.now();
  const pollIntervalMs = 2000;

  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await fetch(`${MAILHOG_URL}/api/v2/messages?limit=50`);
      const data = await response.json();
      const messages = data.items || [];

      for (const msg of messages) {
        const to = msg.To || [];
        if (to.some(t => t.Mailbox + '@' + t.Domain === email) && !seen.has(messageId(msg))) {
          const html = msg.Content.Body || '';
          const patterns = [
            /<strong[^>]*>(\d{6})<\/strong>/i,
            /code[^>]*>(\d{6})</i,
            />\s*(\d{6})\s*</i,
            /\b(\d{6})\b/,
          ];
          for (const pattern of patterns) {
            const match = html.match(pattern);
            if (match) return match[1];
          }
        }
      }
    } catch (error) {
      console.warn(`[seed-task] MailHog poll error: ${error.message}`);
    }
    await sleep(pollIntervalMs);
  }
  throw new Error(`Timeout: No OTP found for ${email} within ${timeoutMs}ms`);
}

async function verifyOtp(email, otp) {
  // Field name must match the passport-local strategy (local.strategy.ts):
  // usernameField=email, passwordField=otp. `providedOtp` is only the
  // VerifyOTPDto shape — sending it here yields a 401.
  const response = await fetch(`${API_URL}/auth/otp/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, otp }),
  });
  const data = await response.json();
  if (!data.success) {
    throw new Error(`OTP verification failed: ${data.message}`);
  }
  // Extract session cookie from response headers
  const cookies = response.headers.get('set-cookie') || '';
  console.log('[seed-task] OTP verified, session established');
  return cookies;
}

async function seedTask(cookie, title, type, deadline, durationMinutes, sessionCount = 1, scheduledStartTime) {
  const response = await fetch(`${API_URL}/test/seed-task`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
    },
    body: JSON.stringify({
      title,
      type,
      deadline,
      durationMinutes,
      sessionCount,
      ...(scheduledStartTime ? { scheduledStartTime } : {}),
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success) {
    const err = new Error(
      `Failed to seed task: ${data.message || `HTTP ${response.status}`}`,
    );
    err.status = response.status;
    throw err;
  }
  console.log('[seed-task] Task seeded:', JSON.stringify(data.data, null, 2));
  return data.data;
}

function readSessionFile() {
  if (!SESSION_FILE) return null;
  try {
    const cookie = fs.readFileSync(SESSION_FILE, 'utf8').trim();
    return cookie || null;
  } catch {
    return null; // no cached session yet
  }
}

function writeSessionFile(cookie) {
  if (SESSION_FILE && cookie) fs.writeFileSync(SESSION_FILE, cookie);
}

/** One OTP login: snapshot MailHog → request → poll (ours only) → verify. */
async function login() {
  const seenBefore = await knownIds(EMAIL);
  await requestOtp(EMAIL);
  console.log('[seed-task] Polling MailHog for OTP...');
  const otp = await getOtpFromMailHog(EMAIL, 60000, seenBefore);
  console.log('[seed-task] OTP received:', otp);
  const cookie = await verifyOtp(EMAIL, otp);
  writeSessionFile(cookie);
  return cookie;
}

async function main() {
  const [title, type, date, durationMinutes, sessionCount, scheduledStart] = process.argv.slice(2);
  if (!title || !type || !date || !durationMinutes || !sessionCount || !scheduledStart) {
    console.error('Usage: node seed-task.js <title> <type> <deadlineISO> <durationMinutes> <sessionCount> <scheduledStartISO>');
    console.error('Types: TASK, DND, ASSIGNMENT, EXAM, LECTURE');
    process.exit(1);
  }

  if (!EMAIL) {
    console.error('[seed-task] E2E_EMAIL environment variable is required');
    process.exit(1);
  }

  const startMs = Date.parse(scheduledStart);
  if (Number.isNaN(startMs)) {
    console.error(`[seed-task] scheduledStartISO is not a valid date: ${scheduledStart}`);
    process.exit(1);
  }

  try {
    console.log('[seed-task] Starting task seeding...');
    console.log('[seed-task] Email:', EMAIL);

    // Reuse the cached session when present (the FIRST seed logs in and
    // writes it; later seeds must NOT request another OTP — that would
    // replace the device's pending login code and count against the
    // 3-per-email request window). A cookie the backend rejects (e.g. the
    // runner reset the DB between runs) falls through to one fresh login.
    let cookie = readSessionFile();
    if (cookie) {
      console.log('[seed-task] Reusing cached seed session');
    } else {
      cookie = await login();
    }

    const deadline = new Date(date).toISOString();
    const doSeed = (c) =>
      seedTask(
        c,
        title,
        type,
        deadline,
        parseInt(durationMinutes),
        parseInt(sessionCount),
        new Date(startMs).toISOString(),
      );

    let result;
    try {
      result = await doSeed(cookie);
    } catch (err) {
      if (err.status !== 401 && err.status !== 403) throw err;
      console.log('[seed-task] Cached session rejected — logging in again');
      cookie = await login();
      result = await doSeed(cookie);
    }

    // Output task ID for shell capture
    if (result.session) {
      console.log(result.session.id);
    } else if (result.sessions && result.sessions.length > 0) {
      console.log(result.sessions[0].id);
    }
    process.exit(0);
  } catch (err) {
    console.error(`[seed-task] ${err.message}`);
    process.exit(1);
  }
}

main();